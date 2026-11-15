#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

struct _OVERLAPPED;

// Direct access to NTFS volumes: the master file table (MFT), which lists
// every file and folder, and the change journal, which logs every change to
// them. Both need administrator rights (they open the volume itself), so the
// readers here are also behind interfaces (RecordSource, JournalSource,
// VolumeAccess) that the index service's pipe client implements the same way
// (ServiceVolumeAccess), for a Win顺 that runs with the user's normal rights.
namespace ws::ntfs {

inline constexpr std::uint32_t kRootRecord = 5; // the root folder's record number

// A record number is the low 48 bits of a file reference number (the high 16
// count reuses of the record). 0 when it does not fit in 32 bits, which would
// take a volume with over 4 billion files.
constexpr std::uint32_t recordOf(std::uint64_t fileReference) noexcept
{
    const std::uint64_t record = fileReference & 0xFFFF'FFFF'FFFFull;
    return record <= 0xFFFF'FFFFull ? static_cast<std::uint32_t>(record) : 0;
}

// ---- MFT -------------------------------------------------------------------

// One file record of the MFT, parsed.
struct FileRecord {
    struct Name {
        std::uint64_t parent; // file reference number of the folder holding it
        std::u16string_view name; // points into the record
    };
    bool inUse = false;
    bool directory = false;
    std::uint32_t baseRecord = 0; // non-zero: an extension of that record
    std::uint32_t attributes = 0; // FILE_ATTRIBUTE_*, from $STANDARD_INFORMATION (base records only)
    std::int64_t modified = 0; // FILETIME of the last write, from there too
    std::int64_t created = 0;
    bool hasAttributeList = false; // some attributes live in extension records
    // The file's size (its unnamed $DATA stream: what GetFileSizeEx says),
    // when this record holds that stream's start: a resident one, or the
    // first piece of a non-resident one (an extension record may hold it
    // for a file with very many attributes). `sizeKnown` false otherwise.
    std::uint64_t size = 0;
    bool sizeKnown = false;
    std::vector<Name> names; // one per hard link; DOS 8.3 aliases are left out
};

// Parses one record, undoing its update sequence protection in place.
// Returns false for anything that is not an intact file record.
bool parseFileRecord(std::byte* data, std::size_t size, FileRecord& out);

struct Extent {
    std::uint64_t offset; // bytes from the start of the volume
    std::uint64_t length; // bytes
};

// Decodes the MFT's run list (the mapping pairs of its $DATA attribute).
// Returns nothing for malformed or sparse runs.
std::optional<std::vector<Extent>> decodeRunList(std::span<const std::byte> pairs, std::uint64_t clusterSize);

// Where a volume's MFT lies, as FSCTL_GET_RETRIEVAL_POINTERS on $MFT tells
// (administrator rights); empty when it does not.
std::vector<Extent> mftExtents(std::wstring_view root, std::uint32_t clusterSize);

// How a volume is laid out, as FSCTL_GET_NTFS_VOLUME_DATA reports it.
struct Geometry {
    std::uint32_t sectorSize = 512;
    std::uint32_t clusterSize = 4096; // 512 bytes (volumes converted from FAT32, old ones) to 2 MB
    std::uint32_t recordSize = 1024; // 4096 on 4K-sector disks and with "format /L"
};

// Whether MftReader reads such a volume: any sizes NTFS uses, a cluster
// smaller than a record too.
bool supported(const Geometry& geometry);

// A stretch of the MFT itself.
struct Stretch {
    std::uint64_t at; // bytes from the MFT's start
    std::uint64_t length; // bytes
};

// The stretches of the first `bytes` of the MFT whose records are all free
// by its bitmap (bit i set: record i in use): whole `granule`s (a multiple
// of 8 records), at least `minBytes` long. Records the bitmap does not reach
// count as in use.
std::vector<Stretch> freeStretches(std::span<const std::byte> bitmap, std::uint32_t recordSize, std::uint64_t granule,
    std::uint64_t minBytes, std::uint64_t bytes);

// One read of the MFT.
struct Read {
    std::uint64_t offset; // bytes from the start of the volume
    std::uint64_t length; // bytes
    std::uint64_t at; // where they are in the MFT
};

// The reads that cover the first `bytes` of the MFT but `skip` (sorted, and
// on cluster boundaries), in order: each within one extent, of whole clusters
// (the volume is read unbuffered), and at most `blockBytes` long.
std::vector<Read> planReads(std::span<const Extent> extents, std::uint64_t bytes, std::uint32_t clusterSize,
    std::uint64_t blockBytes, std::span<const Stretch> skip = {});

struct ReadOptions {
    // At least 2, so the disk reads the next block while this one is parsed;
    // 4 was 9-16 % faster than 2 on an NVMe SSD (for 16 MB of buffers).
    int readsInFlight = 4;
    bool skipFree = true; // leave out long stretches of free records (by the MFT's bitmap)
};

// Where a volume's MFT records come from, block by block: the volume itself
// (MftReader) or the index service (ServiceVolumeAccess). MftTree::read is
// the consumer.
class RecordSource {
public:
    virtual ~RecordSource() = default;

    virtual bool valid() const noexcept = 0; // false: error() says why
    virtual const std::wstring& error() const noexcept = 0;
    virtual std::uint64_t recordCount() const noexcept = 0;
    virtual std::uint64_t bytes() const noexcept = 0; // of the MFT that hold records
    virtual std::uint64_t bytesDone() const noexcept = 0; // of those, handed out or left out so far

    // The next block. False at the end, or on an error (valid() tells which).
    virtual bool next() = 0;
    virtual std::uint32_t firstRecord() const noexcept = 0; // the number of the block's first record
    virtual std::size_t blockRecords() const noexcept = 0;
    virtual bool parse(std::size_t i, FileRecord& out) = 0; // record i of the current block
};

// Reads a volume's MFT front to back in large blocks, a few at a time.
class MftReader final : public RecordSource {
public:
    explicit MftReader(std::wstring_view root, ReadOptions options = {}); // "C:"
    // An MFT in a volume image held in memory (tests). Without `extents`,
    // they are read from the MFT's own record at `mftStart` (bytes).
    MftReader(std::span<const std::byte> image, Geometry geometry, std::vector<Extent> extents, std::uint64_t mftStart,
        std::uint64_t validBytes, ReadOptions options = {});
    ~MftReader();
    MftReader(const MftReader&) = delete;
    MftReader& operator=(const MftReader&) = delete;

    bool valid() const noexcept override { return m_error.empty(); }
    const std::wstring& error() const noexcept override { return m_error; }
    const Geometry& geometry() const noexcept { return m_geometry; }
    std::uint64_t recordCount() const noexcept override { return m_validBytes / m_geometry.recordSize; }
    std::uint64_t bytes() const noexcept override { return m_validBytes; }
    std::uint64_t bytesDone() const noexcept override { return m_streamPos; }
    std::uint64_t bytesSkipped() const noexcept { return m_skipped; } // left out: free records only
    std::size_t extentCount() const noexcept { return m_extents.size(); } // diagnostics
    std::span<const std::byte> bitmap() const noexcept { return m_bitmap; } // diagnostics: empty when none was read
    std::uint32_t bitmapRecord() const noexcept { return m_bitmapRecord; } // diagnostics
    const std::wstring& bitmapNote() const noexcept { return m_bitmapNote; } // diagnostics: where it was, or why not
    bool extentsFromRecordZero() const noexcept { return m_fromRecordZero; } // diagnostics

    // Reads the next block. False at the end, or on a read error (error() says).
    bool next() override;
    std::uint32_t firstRecord() const noexcept override { return m_firstRecord; }
    std::size_t blockRecords() const noexcept override { return m_blockRecords; }
    bool parse(std::size_t i, FileRecord& out) override;
    // The bytes of record i of the current block: fixed up once parse(i) has
    // been called on it, raw before (NtfsBulk reads a file's $DATA from them).
    std::span<std::byte> recordBytes(std::size_t i) noexcept
    {
        return i < m_blockRecords ? std::span<std::byte>(m_records + i * m_geometry.recordSize, m_geometry.recordSize)
                                  : std::span<std::byte>();
    }

private:
    class Device;
    class VolumeDevice;
    class ImageDevice;
    // A read in flight or done. Its data is preceded by room for the start
    // of a record that the read before it ended with.
    struct Slot {
        std::byte* data = nullptr;
        std::uint32_t bytes = 0;
        std::uint64_t at = 0; // where its data is in the MFT
        std::size_t carried = 0; // bytes of a record copied in front of `data`
        bool pending = false;
    };

    void start(std::uint64_t mftStart);
    bool readRecordZero(std::uint64_t mftStart, std::wstring& error); // into the first buffer
    bool extentsFrom(const std::byte* recordZero);
    std::vector<std::byte> bitmapFrom(const std::byte* recordZero);
    std::vector<std::byte> readRecord(std::uint32_t number); // fixed up; through the second buffer
    std::vector<std::byte> readRuns(std::span<const Extent> runs, std::uint64_t size); // through the second buffer
    bool readInto(int slot, std::uint64_t offset, std::uint32_t bytes); // into that slot's buffer, waited for
    bool issue(int slot); // starts the next planned read in `slot`
    void fail(const wchar_t* what);

    std::unique_ptr<Device> m_device;
    ReadOptions m_options;
    std::wstring m_error;
    Geometry m_geometry;
    std::uint64_t m_validBytes = 0;
    std::vector<Extent> m_extents;
    bool m_fromRecordZero = false;
    std::vector<Read> m_plan;
    std::size_t m_planned = 0; // reads started so far
    std::uint64_t m_skipped = 0;
    std::vector<std::byte> m_bitmap;
    std::uint32_t m_bitmapRecord = 0; // the record its first part was found in
    std::wstring m_bitmapNote;
    std::byte* m_memory = nullptr;
    std::vector<Slot> m_slots; // in a ring: the reads in flight, in the MFT's order
    int m_turn = 0; // the slot whose read comes next in the MFT
    int m_handedOut = -1; // the slot whose records the caller is parsing
    std::uint64_t m_streamPos = 0; // where in the MFT the records still to hand out begin
    std::byte* m_records = nullptr;
    std::uint32_t m_firstRecord = 0;
    std::size_t m_blockRecords = 0;
};

// ---- change journal ----------------------------------------------------------

struct JournalInfo {
    std::uint64_t id = 0;
    std::int64_t firstUsn = 0; // the oldest record still kept
    std::int64_t nextUsn = 0; // where the next record will go
};

// ToolKnit: read-only probe; returns no value when the volume has no journal.
std::optional<JournalInfo> queryJournal(std::wstring_view root);

struct UsnRecord {
    std::uint64_t file; // file reference number
    std::uint64_t parent; // of its folder
    std::int64_t usn;
    std::uint32_t reason; // USN_REASON_*
    std::uint32_t attributes; // FILE_ATTRIBUTE_*
    std::u16string_view name; // points into the read buffer
    std::int64_t time = 0; // FILETIME of the change
};

// Parses what FSCTL_READ_USN_JOURNAL returns. Returns the USN to continue
// from, or -1 when the buffer is malformed.
std::int64_t parseUsnRecords(std::span<const std::byte> data, std::vector<UsnRecord>& out);

// One volume's change journal, read a batch at a time with an event to wait
// on, so that one thread can wait on several volumes (IndexService::
// followJournals): the volume itself (JournalReader) or the index service.
class JournalSource {
public:
    virtual ~JournalSource() = default;

    virtual bool valid() const noexcept = 0;
    virtual void* event() const noexcept = 0; // signaled when a read completes

    // Starts reading from `usn` on. With `wait` the read completes once there
    // is something new; without, at once (possibly with nothing).
    virtual void start(std::int64_t usn, bool wait) = 0;
    // Waits for the read to complete. False when the journal no longer has
    // those records (it wrapped, or was deleted) or the volume is gone.
    // Records point into this source's buffer until the next start().
    virtual bool finish(std::vector<UsnRecord>& records, std::int64_t& nextUsn) = 0;
    virtual void cancel() = 0;
};

// Reads one volume's change journal with overlapped I/O. Only name,
// attribute, link and content changes are read.
class JournalReader final : public JournalSource {
public:
    JournalReader(std::wstring_view root, std::uint64_t journalId);
    ~JournalReader() override;
    JournalReader(const JournalReader&) = delete;
    JournalReader& operator=(const JournalReader&) = delete;

    bool valid() const noexcept override;
    void* event() const noexcept override { return m_event; }

    void start(std::int64_t usn, bool wait) override;
    bool finish(std::vector<UsnRecord>& records, std::int64_t& nextUsn) override;
    // The same, as FSCTL_READ_USN_JOURNAL returned it (the next USN, then the
    // records): what the index service forwards. GetLastError() says why not.
    bool finishRaw(std::span<const std::byte>& data);
    void cancel() override;

private:
    void* m_volume = nullptr;
    void* m_event = nullptr;
    std::uint64_t m_journalId;
    std::vector<std::uint64_t> m_buffer; // 8-byte aligned
    std::unique_ptr<_OVERLAPPED> m_overlapped;
    bool m_pending = false;
    unsigned long m_startError = 0;
};

// ---- files read by their records (the content index's bulk path) ---------------

// The content index's first build reads hundreds of thousands of files, and
// the antivirus scans each one as it is opened. Read off the volume by their
// MFT records instead (NtfsBulk.h), with no file opened: the client names
// each file by its folder's record number and its name (what the index
// has), the volume is scanned once, and the bytes of the files the client
// may read (an access check against its token, in the service) come back in
// the order they lie on the disk. Anything doubtful is left to the normal
// path: BulkSkip says why.
enum class BulkSkip : std::uint8_t {
    None,
    NotFound, // no record with that parent and name
    Directory,
    NoData, // no unnamed $DATA
    SeveralParts, // the $DATA is in parts, or an attribute list may hold more of it
    Compressed,
    Encrypted,
    Reparse, // a reparse point: WOF-compressed, a cloud placeholder, a symbolic link...
    RunList, // malformed, or not covering the attribute
    TooLarge, // over the caller's limit (the size is still reported)
};
const char* bulkSkipName(BulkSkip skip) noexcept;

enum class BulkStatus : std::uint8_t {
    Data, // the bytes can be fetched
    NotFound,
    Denied, // the client may not read it (or that could not be made sure of)
    Fallback, // not read this way: BulkFile::reason
    TooLarge, // over the limit asked for: the size is given
};

// One file asked for: the record number of its folder (FileIndex keeps
// those) and its name, exactly as the MFT has it. The i-th want is ticket i.
struct BulkWant {
    std::uint32_t parentRecord;
    std::u16string name;
    std::uint64_t maxBytes; // read none of a larger file
};

// What the scan found about one want.
struct BulkFile {
    std::uint32_t ticket;
    BulkStatus status;
    BulkSkip reason; // with Fallback
    std::uint64_t size; // the file's, as GetFileSizeEx would say (Data, TooLarge)
    std::int64_t modified; // FILETIME of the last write (Data, TooLarge)
};

// One bulk session on one volume: the volume itself (DirectBulkSource, in
// NtfsBulk.cpp: the elevated program's own reads, no access check) or the
// index service. want() any number of times, then scan() once, then fetch()
// the Data tickets in batches (each batch's bytes come whole, then fetch
// returns); destroying it ends the session.
class BulkSource {
public:
    virtual ~BulkSource() = default;
    virtual bool valid() const noexcept = 0; // false: error() says why
    virtual const std::wstring& error() const noexcept = 0;
    virtual bool want(std::span<const BulkWant> wants) = 0;
    // Scans the volume; `files` gets one entry per ticket, those with Data
    // in the order they are best fetched (as they lie on the disk).
    virtual bool scan(std::vector<BulkFile>& files) = 0;
    // The bytes of those tickets (Data ones not fetched before), each handed
    // to `sink` whole: min(size, maxBytes) bytes.
    virtual bool fetch(std::span<const std::uint32_t> tickets,
        const std::function<void(std::uint32_t ticket, std::vector<std::byte>&& bytes)>& sink) = 0;
};

// ---- where the volumes are read from ------------------------------------------

// What the index needs of an NTFS volume, from wherever it comes: the
// volume itself (DirectVolumeAccess, administrator rights), the index
// service (ServiceVolumeAccess), or nowhere (NoVolumeAccess: every volume is
// walked and watched instead). One per IndexService; its methods are called
// from the worker threads, several at a time.
class VolumeAccess {
public:
    enum class Kind { Direct, Service, None };

    virtual ~VolumeAccess() = default;
    virtual Kind kind() const noexcept = 0;

    // The volume's MFT, front to back. Null when there is no way to it; else
    // a source whose valid() and error() say whether it opened. `serial` is
    // the volume's (VolumeInfo), so that a drive letter taken over by another
    // disk meanwhile is refused; 0 skips that. With `lowPriority` the reads
    // yield to everything else (the caller's thread is in background mode
    // already; the service puts its own there).
    virtual std::unique_ptr<RecordSource> openMft(std::wstring_view root, std::uint32_t serial, bool lowPriority) = 0;
    // The volume's change journal, created if it has none. Nothing when it
    // cannot be read: the volume is then walked.
    virtual std::optional<JournalInfo> queryJournal(std::wstring_view root, std::uint32_t serial) = 0;
    // Follows that journal. Null, or a source whose valid() says whether it opened.
    virtual std::unique_ptr<JournalSource> openJournal(std::wstring_view root, std::uint32_t serial,
        std::uint64_t journalId) = 0;
    // Before the volume is ejected or locked: returns once nothing opened on
    // our behalf holds it any more (the sources on it are destroyed first).
    virtual void closeVolume(std::wstring_view root) = 0;
    // Files read by their records (BulkSource): null when there is no way to
    // that (no access, or a service without the capability), else a source
    // whose valid() says whether it opened. `quiet`: someone uses the
    // computer and the volume is on a hard disk: one read at a time, at very
    // low I/O priority.
    virtual std::unique_ptr<BulkSource> openBulkRead(std::wstring_view root, std::uint32_t serial, bool quiet) = 0;
};

// The volume itself: MftReader, queryJournal(), JournalReader.
class DirectVolumeAccess final : public VolumeAccess {
public:
    Kind kind() const noexcept override { return Kind::Direct; }
    std::unique_ptr<RecordSource> openMft(std::wstring_view root, std::uint32_t serial, bool lowPriority) override;
    std::optional<JournalInfo> queryJournal(std::wstring_view root, std::uint32_t serial) override;
    std::unique_ptr<JournalSource> openJournal(std::wstring_view root, std::uint32_t serial,
        std::uint64_t journalId) override;
    void closeVolume(std::wstring_view root) override; // nothing to do: the sources held the handles
    std::unique_ptr<BulkSource> openBulkRead(std::wstring_view root, std::uint32_t serial, bool quiet) override; // NtfsBulk.cpp
};

// No way to the MFT or the journals (normal rights, no service).
class NoVolumeAccess final : public VolumeAccess {
public:
    Kind kind() const noexcept override { return Kind::None; }
    std::unique_ptr<RecordSource> openMft(std::wstring_view, std::uint32_t, bool) override { return nullptr; }
    std::optional<JournalInfo> queryJournal(std::wstring_view, std::uint32_t) override { return std::nullopt; }
    std::unique_ptr<JournalSource> openJournal(std::wstring_view, std::uint32_t, std::uint64_t) override
    {
        return nullptr;
    }
    void closeVolume(std::wstring_view) override { }
    std::unique_ptr<BulkSource> openBulkRead(std::wstring_view, std::uint32_t, bool) override { return nullptr; }
};

} // namespace ws::ntfs
