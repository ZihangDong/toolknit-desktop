#include "Ntfs.h"

#include <windows.h>
#include <winioctl.h>

#include <algorithm>
#include <cstring>
#include <utility>

namespace ws::ntfs {

namespace {

template <typename T> T load(const std::byte* p) noexcept
{
    T v;
    std::memcpy(&v, p, sizeof v);
    return v;
}

// File record layout (offsets into the record).
constexpr std::uint32_t kFileSignature = 0x454C4946; // "FILE"
constexpr std::size_t kUsaOffset = 0x04;
constexpr std::size_t kUsaCount = 0x06;
constexpr std::size_t kFirstAttribute = 0x14;
constexpr std::size_t kRecordFlags = 0x16;
constexpr std::size_t kBytesInUse = 0x18;
constexpr std::size_t kBaseRecord = 0x20;
constexpr std::uint16_t kInUse = 0x0001;
constexpr std::uint16_t kIsDirectory = 0x0002;
constexpr std::size_t kStride = 512; // update sequence stride, whatever the sector size

// Attribute types, and the fields we read.
constexpr std::uint32_t kStandardInformation = 0x10;
constexpr std::uint32_t kAttributeList = 0x20;
constexpr std::uint32_t kFileName = 0x30;
constexpr std::uint32_t kData = 0x80;
constexpr std::uint32_t kBitmap = 0xB0;
constexpr std::uint32_t kEndOfAttributes = 0xFFFF'FFFF;
constexpr std::uint8_t kDosNamespace = 2; // the 8.3 alias of a long name

constexpr std::uint64_t kBlockBytes = 4u << 20; // per read: larger gains nothing, even on a hard disk
constexpr std::uint32_t kPageBytes = 4096;
constexpr std::uint32_t kMaxClusterBytes = 16u << 20; // NTFS goes up to 2 MB
constexpr std::uint32_t kMaxRecordBytes = 64u << 10; // NTFS uses 1 KB or 4 KB
constexpr DWORD kJournalBufferBytes = 128 * 1024;
constexpr DWORD kReasonMask = USN_REASON_FILE_CREATE | USN_REASON_FILE_DELETE | USN_REASON_RENAME_OLD_NAME
    | USN_REASON_RENAME_NEW_NAME | USN_REASON_BASIC_INFO_CHANGE | USN_REASON_HARD_LINK_CHANGE
    | USN_REASON_DATA_OVERWRITE | USN_REASON_DATA_EXTEND | USN_REASON_DATA_TRUNCATION | USN_REASON_SECURITY_CHANGE;

HANDLE openVolume(std::wstring_view root, DWORD access, DWORD flags)
{
    const std::wstring path = L"\\\\.\\" + std::wstring(root);
    const HANDLE h = ::CreateFileW(path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, flags, nullptr);
    return h == INVALID_HANDLE_VALUE ? nullptr : h;
}

void closeHandle(void*& h)
{
    if (h)
        ::CloseHandle(h);
    h = nullptr;
}

// Every 512-byte stride of a record ends with a check value; the bytes it
// replaced are kept in the update sequence array. A mismatch means the
// record was torn while being written.
bool applyFixups(std::byte* data, std::size_t size)
{
    if (size < 0x30 || load<std::uint32_t>(data) != kFileSignature)
        return false;
    const auto usaOffset = load<std::uint16_t>(data + kUsaOffset);
    const auto usaCount = load<std::uint16_t>(data + kUsaCount);
    if (usaCount < 2 || (usaCount - 1u) * kStride > size || usaOffset + usaCount * 2u > size)
        return false;
    const auto check = load<std::uint16_t>(data + usaOffset);
    for (std::size_t i = 1; i < usaCount; ++i) {
        std::byte* tail = data + i * kStride - 2;
        if (load<std::uint16_t>(tail) != check)
            return false;
        std::memcpy(tail, data + usaOffset + i * 2, 2);
    }
    return true;
}

// Calls f(type, header, length) for each attribute of a fixed-up record.
template <typename F> bool forEachAttribute(const std::byte* data, std::size_t size, F&& f)
{
    const std::size_t used = std::min<std::size_t>(load<std::uint32_t>(data + kBytesInUse), size);
    std::size_t pos = load<std::uint16_t>(data + kFirstAttribute);
    while (pos + 4 <= used) {
        const auto type = load<std::uint32_t>(data + pos);
        if (type == kEndOfAttributes)
            break;
        const auto length = pos + 8 <= used ? load<std::uint32_t>(data + pos + 4) : 0;
        if (length < 16 || length > used - pos)
            return false;
        f(type, data + pos, static_cast<std::size_t>(length));
        pos += length;
    }
    return true;
}

// The value of a resident attribute, or an empty span.
std::span<const std::byte> residentValue(const std::byte* attribute, std::size_t length)
{
    if (length < 0x18 || attribute[8] != std::byte {0})
        return {};
    const auto valueLength = load<std::uint32_t>(attribute + 0x10);
    const auto valueOffset = load<std::uint16_t>(attribute + 0x14);
    if (valueOffset > length || valueLength > length - valueOffset)
        return {};
    return {attribute + valueOffset, valueLength};
}

// Where the MFT lies on the volume, as the file system tells; empty when it
// does not.
std::vector<Extent> retrievalPointers(std::wstring_view root, std::uint32_t clusterSize)
{
    std::vector<Extent> extents;
    const std::wstring mftPath = L"\\\\?\\" + std::wstring(root) + L"\\$MFT";
    const HANDLE mft = ::CreateFileW(mftPath.c_str(), FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (mft == INVALID_HANDLE_VALUE)
        return extents;
    std::vector<std::uint64_t> buffer(8192); // RETRIEVAL_POINTERS_BUFFER, 64 KB
    STARTING_VCN_INPUT_BUFFER in {};
    bool ok = true;
    for (;;) {
        DWORD bytes = 0;
        const BOOL done = ::DeviceIoControl(mft, FSCTL_GET_RETRIEVAL_POINTERS, &in, sizeof in, buffer.data(),
            static_cast<DWORD>(buffer.size() * sizeof(std::uint64_t)), &bytes, nullptr);
        if (!done && ::GetLastError() != ERROR_MORE_DATA) {
            ok = false;
            break;
        }
        const auto* rp = reinterpret_cast<const RETRIEVAL_POINTERS_BUFFER*>(buffer.data());
        std::int64_t vcn = rp->StartingVcn.QuadPart;
        for (DWORD k = 0; k < rp->ExtentCount; ++k) {
            const std::int64_t nextVcn = rp->Extents[k].NextVcn.QuadPart;
            const std::int64_t lcn = rp->Extents[k].Lcn.QuadPart;
            if (lcn < 0 || nextVcn <= vcn) {
                ok = false;
                break;
            }
            extents.push_back({static_cast<std::uint64_t>(lcn) * clusterSize,
                static_cast<std::uint64_t>(nextVcn - vcn) * clusterSize});
            vcn = nextVcn;
        }
        if (!ok || done || rp->ExtentCount == 0)
            break;
        in.StartingVcn.QuadPart = vcn;
    }
    ::CloseHandle(mft);
    if (!ok)
        extents.clear();
    return extents;
}

} // namespace

std::vector<Extent> mftExtents(std::wstring_view root, std::uint32_t clusterSize)
{
    return retrievalPointers(root, clusterSize);
}

bool parseFileRecord(std::byte* data, std::size_t size, FileRecord& out)
{
    out.inUse = false;
    out.directory = false;
    out.baseRecord = 0;
    out.attributes = 0;
    out.modified = 0;
    out.created = 0;
    out.hasAttributeList = false;
    out.size = 0;
    out.sizeKnown = false;
    out.names.clear();
    if (!applyFixups(data, size))
        return false;
    const auto flags = load<std::uint16_t>(data + kRecordFlags);
    out.inUse = flags & kInUse;
    out.directory = flags & kIsDirectory;
    out.baseRecord = recordOf(load<std::uint64_t>(data + kBaseRecord));
    if (!out.inUse)
        return true;
    return forEachAttribute(data, size, [&](std::uint32_t type, const std::byte* attribute, std::size_t length) {
        if (type == kAttributeList) {
            out.hasAttributeList = true;
            return;
        }
        if (type == kData) {
            // The unnamed stream alone (a named one is an alternate stream):
            // resident, its value; non-resident, the real size in the header
            // of its first piece (lowest VCN 0; a later piece says nothing).
            if (length < 0x18 || attribute[9] != std::byte {0})
                return;
            if (attribute[8] == std::byte {0}) {
                out.size = load<std::uint32_t>(attribute + 0x10);
                out.sizeKnown = true;
            } else if (length >= 0x38 && load<std::uint64_t>(attribute + 0x10) == 0) {
                out.size = load<std::uint64_t>(attribute + 0x30);
                out.sizeKnown = true;
            }
            return;
        }
        const auto value = residentValue(attribute, length);
        if (type == kStandardInformation && value.size() >= 0x24) {
            out.attributes = load<std::uint32_t>(value.data() + 0x20);
            out.modified = load<std::int64_t>(value.data() + 0x08);
            out.created = load<std::int64_t>(value.data());
        } else if (type == kFileName && value.size() >= 0x42) {
            const auto nameLength = static_cast<std::uint8_t>(value[0x40]);
            const auto nameSpace = static_cast<std::uint8_t>(value[0x41]);
            if (nameSpace == kDosNamespace || nameLength == 0 || 0x42 + nameLength * 2u > value.size())
                return;
            out.names.push_back({load<std::uint64_t>(value.data()),
                {reinterpret_cast<const char16_t*>(value.data() + 0x42), nameLength}});
        }
    });
}

std::optional<std::vector<Extent>> decodeRunList(std::span<const std::byte> pairs, std::uint64_t clusterSize)
{
    std::vector<Extent> extents;
    std::int64_t lcn = 0;
    std::size_t i = 0;
    while (i < pairs.size()) {
        const auto header = static_cast<std::uint8_t>(pairs[i++]);
        if (header == 0)
            return extents;
        const unsigned lengthBytes = header & 0x0F;
        const unsigned offsetBytes = header >> 4;
        // A run without an offset is sparse: never part of the MFT.
        if (lengthBytes == 0 || lengthBytes > 8 || offsetBytes == 0 || offsetBytes > 8
            || lengthBytes + offsetBytes > pairs.size() - i)
            return std::nullopt;
        std::uint64_t length = 0;
        for (unsigned b = 0; b < lengthBytes; ++b)
            length |= std::uint64_t {static_cast<std::uint8_t>(pairs[i + b])} << (8 * b);
        i += lengthBytes;
        std::uint64_t delta = 0;
        for (unsigned b = 0; b < offsetBytes; ++b)
            delta |= std::uint64_t {static_cast<std::uint8_t>(pairs[i + b])} << (8 * b);
        if (offsetBytes < 8 && (static_cast<std::uint8_t>(pairs[i + offsetBytes - 1]) & 0x80))
            delta |= ~std::uint64_t {0} << (8 * offsetBytes); // relative to the previous run: signed
        i += offsetBytes;
        lcn += static_cast<std::int64_t>(delta);
        if (lcn < 0 || length == 0)
            return std::nullopt;
        extents.push_back({static_cast<std::uint64_t>(lcn) * clusterSize, length * clusterSize});
    }
    return std::nullopt; // no end marker
}

// ---- MftReader --------------------------------------------------------------

bool supported(const Geometry& g)
{
    const auto powerOfTwo = [](std::uint32_t v) { return v != 0 && (v & (v - 1)) == 0; };
    return powerOfTwo(g.sectorSize) && powerOfTwo(g.clusterSize) && powerOfTwo(g.recordSize) && g.sectorSize >= 512
        && g.clusterSize >= g.sectorSize && g.clusterSize <= kMaxClusterBytes && g.recordSize >= kStride
        && g.recordSize <= kMaxRecordBytes;
}

std::vector<Stretch> freeStretches(std::span<const std::byte> bitmap, std::uint32_t recordSize, std::uint64_t granule,
    std::uint64_t minBytes, std::uint64_t bytes)
{
    std::vector<Stretch> out;
    if (recordSize == 0 || granule % (std::uint64_t {recordSize} * 8) != 0)
        return out;
    const std::uint64_t perGranule = granule / recordSize / 8; // bytes of the bitmap
    Stretch run {0, 0};
    const auto close = [&] {
        if (run.length > 0 && run.length >= minBytes)
            out.push_back(run);
        run.length = 0;
    };
    for (std::uint64_t at = 0, first = 0; at < bytes; at += granule, first += perGranule) {
        const bool free = first + perGranule <= bitmap.size()
            && std::all_of(bitmap.begin() + static_cast<std::ptrdiff_t>(first),
                bitmap.begin() + static_cast<std::ptrdiff_t>(first + perGranule),
                [](std::byte b) { return b == std::byte {0}; });
        if (!free) {
            close();
            continue;
        }
        if (run.length == 0)
            run.at = at;
        run.length += granule;
    }
    close();
    return out;
}

std::vector<Read> planReads(std::span<const Extent> extents, std::uint64_t bytes, std::uint32_t clusterSize,
    std::uint64_t blockBytes, std::span<const Stretch> skip)
{
    std::vector<Read> plan;
    const std::uint64_t end = (bytes + clusterSize - 1) / clusterSize * clusterSize;
    std::uint64_t start = 0; // of the extent, in the MFT
    std::size_t s = 0; // the next stretch to leave out
    for (const Extent& e : extents) {
        for (std::uint64_t pos = 0; pos < e.length && start + pos < end;) {
            const std::uint64_t at = start + pos;
            while (s < skip.size() && skip[s].at + skip[s].length <= at)
                ++s;
            if (s < skip.size() && skip[s].at <= at) {
                pos = std::min(e.length, skip[s].at + skip[s].length - start); // over it
                continue;
            }
            std::uint64_t n = std::min({blockBytes, e.length - pos, end - at});
            if (s < skip.size())
                n = std::min(n, skip[s].at - at); // up to it
            plan.push_back({e.offset + pos, n, at});
            pos += n;
        }
        start += e.length;
    }
    return plan;
}

// Where the reader's bytes come from.
class MftReader::Device {
public:
    virtual ~Device() = default;
    // Starts reading `bytes` at `offset` into `into`, as read number `slot`.
    virtual bool begin(int slot, std::uint64_t offset, std::byte* into, std::uint32_t bytes) = 0;
    // Waits for that read: the bytes read, or nothing on an error.
    virtual std::optional<std::uint32_t> end(int slot) = 0;
};

// The volume, read unbuffered (the MFT is read once: it should not crowd the
// file cache), with several reads in flight.
class MftReader::VolumeDevice final : public Device {
public:
    VolumeDevice(std::wstring_view root, int slots)
        : m_reads(static_cast<std::size_t>(slots))
    {
        for (Pending& r : m_reads)
            r.overlapped.hEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);
        m_volume = openVolume(root, GENERIC_READ, FILE_FLAG_NO_BUFFERING | FILE_FLAG_OVERLAPPED); // last: its error stays
    }
    ~VolumeDevice() override
    {
        // A read in flight writes into the reader's buffers: it ends before they go.
        if (m_volume && std::any_of(m_reads.begin(), m_reads.end(), [](const Pending& r) { return r.pending; })) {
            ::CancelIoEx(m_volume, nullptr);
            for (Pending& r : m_reads) {
                DWORD ignored = 0;
                if (r.pending)
                    ::GetOverlappedResult(m_volume, &r.overlapped, &ignored, TRUE);
            }
        }
        for (Pending& r : m_reads)
            closeHandle(r.overlapped.hEvent);
        closeHandle(m_volume);
    }
    VolumeDevice(const VolumeDevice&) = delete;
    VolumeDevice& operator=(const VolumeDevice&) = delete;

    bool valid() const noexcept
    {
        return m_volume
            && std::all_of(m_reads.begin(), m_reads.end(), [](const Pending& r) { return r.overlapped.hEvent; });
    }

    // A control request on the (overlapped) handle, waited for. Before any read.
    bool control(DWORD code, void* out, DWORD outBytes)
    {
        OVERLAPPED o {};
        o.hEvent = m_reads[0].overlapped.hEvent;
        DWORD bytes = 0;
        if (!::DeviceIoControl(m_volume, code, nullptr, 0, out, outBytes, nullptr, &o)
            && ::GetLastError() != ERROR_IO_PENDING)
            return false;
        return ::GetOverlappedResult(m_volume, &o, &bytes, TRUE);
    }

    bool begin(int slot, std::uint64_t offset, std::byte* into, std::uint32_t bytes) override
    {
        Pending& r = m_reads[static_cast<std::size_t>(slot)];
        const HANDLE event = r.overlapped.hEvent;
        r.overlapped = OVERLAPPED {};
        r.overlapped.Offset = static_cast<DWORD>(offset);
        r.overlapped.OffsetHigh = static_cast<DWORD>(offset >> 32);
        r.overlapped.hEvent = event;
        if (!::ReadFile(m_volume, into, bytes, nullptr, &r.overlapped) && ::GetLastError() != ERROR_IO_PENDING)
            return false;
        r.pending = true;
        return true;
    }

    std::optional<std::uint32_t> end(int slot) override
    {
        Pending& r = m_reads[static_cast<std::size_t>(slot)];
        if (!std::exchange(r.pending, false))
            return std::nullopt;
        DWORD read = 0;
        if (!::GetOverlappedResult(m_volume, &r.overlapped, &read, TRUE))
            return std::nullopt;
        return read;
    }

private:
    struct Pending {
        OVERLAPPED overlapped {};
        bool pending = false;
    };
    void* m_volume = nullptr;
    std::vector<Pending> m_reads; // never resized: the system holds pointers to them
};

// A volume image in memory.
class MftReader::ImageDevice final : public Device {
public:
    ImageDevice(std::span<const std::byte> image, int slots)
        : m_image(image)
        , m_read(static_cast<std::size_t>(slots))
    {
    }

    bool begin(int slot, std::uint64_t offset, std::byte* into, std::uint32_t bytes) override
    {
        const std::uint64_t n = offset < m_image.size() ? std::min<std::uint64_t>(bytes, m_image.size() - offset) : 0;
        if (n > 0)
            std::memcpy(into, m_image.data() + offset, static_cast<std::size_t>(n));
        m_read[static_cast<std::size_t>(slot)] = static_cast<std::uint32_t>(n);
        return true;
    }

    std::optional<std::uint32_t> end(int slot) override { return m_read[static_cast<std::size_t>(slot)]; }

private:
    std::span<const std::byte> m_image;
    std::vector<std::uint32_t> m_read;
};

MftReader::MftReader(std::wstring_view root, ReadOptions options)
    : m_options(options)
{
    m_options.readsInFlight = std::max(2, m_options.readsInFlight);
    auto volume = std::make_unique<VolumeDevice>(root, m_options.readsInFlight);
    if (!volume->valid()) {
        fail(L"open volume");
        return;
    }
    NTFS_VOLUME_DATA_BUFFER data {};
    if (!volume->control(FSCTL_GET_NTFS_VOLUME_DATA, &data, sizeof data)) {
        fail(L"FSCTL_GET_NTFS_VOLUME_DATA");
        return;
    }
    m_device = std::move(volume);
    m_geometry = {static_cast<std::uint32_t>(data.BytesPerSector), static_cast<std::uint32_t>(data.BytesPerCluster),
        static_cast<std::uint32_t>(data.BytesPerFileRecordSegment)};
    m_validBytes = static_cast<std::uint64_t>(data.MftValidDataLength.QuadPart);
    if (supported(m_geometry))
        m_extents = retrievalPointers(root, m_geometry.clusterSize);
    start(static_cast<std::uint64_t>(data.MftStartLcn.QuadPart) * m_geometry.clusterSize);
}

MftReader::MftReader(std::span<const std::byte> image, Geometry geometry, std::vector<Extent> extents,
    std::uint64_t mftStart, std::uint64_t validBytes, ReadOptions options)
    : m_options(options)
    , m_geometry(geometry)
    , m_validBytes(validBytes)
    , m_extents(std::move(extents))
{
    m_options.readsInFlight = std::max(2, m_options.readsInFlight);
    m_device = std::make_unique<ImageDevice>(image, m_options.readsInFlight);
    start(mftStart);
}

MftReader::~MftReader()
{
    m_device.reset(); // waits for the reads in flight
    if (m_memory)
        ::VirtualFree(m_memory, 0, MEM_RELEASE);
}

void MftReader::fail(const wchar_t* what)
{
    m_error = std::wstring(what) + L" failed, error " + std::to_wstring(::GetLastError());
}

void MftReader::start(std::uint64_t mftStart)
{
    const Geometry& g = m_geometry;
    if (!supported(g)) {
        m_error = L"unsupported layout: " + std::to_wstring(g.sectorSize) + L"-byte sectors, "
            + std::to_wstring(g.clusterSize) + L"-byte clusters, " + std::to_wstring(g.recordSize) + L"-byte records";
        return;
    }
    // A buffer per read in flight, each a block with room in front for the
    // start of a record that the block before it ended with. Unbuffered
    // reads go to aligned memory.
    const std::uint64_t block = std::max<std::uint64_t>(kBlockBytes, g.clusterSize);
    const std::uint32_t align = std::max(kPageBytes, g.sectorSize);
    const std::size_t front = (g.recordSize + align - 1) / align * align;
    const auto slots = static_cast<std::size_t>(m_options.readsInFlight);
    m_memory = static_cast<std::byte*>(
        ::VirtualAlloc(nullptr, slots * (front + block), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE));
    if (!m_memory) {
        fail(L"VirtualAlloc");
        return;
    }
    m_slots.resize(slots);
    for (std::size_t s = 0; s < slots; ++s)
        m_slots[s].data = m_memory + s * (front + block) + front;

    // The MFT's own record (record 0, in the first buffer): where the MFT is,
    // when the file system did not say, and which of its records are in use.
    const std::byte* const record = m_slots[0].data;
    std::wstring recordError;
    const bool haveRecord = readRecordZero(mftStart, recordError);
    if (m_extents.empty()) {
        m_fromRecordZero = true;
        if (!haveRecord) {
            m_error = recordError;
            return;
        }
        if (!extentsFrom(record))
            return;
    }
    std::uint64_t allocated = 0;
    for (const Extent& e : m_extents)
        allocated += e.length;
    if (allocated < m_validBytes) {
        m_error = L"the MFT's extents end before its last record";
        return;
    }
    // Long stretches of free records are not read: the MFT keeps the room of
    // files deleted long ago, and grows ahead of need. They are whole granules
    // of 1 MB or more: a record never runs across their edges.
    std::vector<Stretch> skip;
    if (!haveRecord) {
        m_bitmapNote = recordError;
    } else if (m_options.skipFree) {
        const std::uint64_t granule = std::max<std::uint64_t>({1u << 20, g.clusterSize, g.recordSize * 8u});
        m_bitmap = bitmapFrom(record);
        skip = freeStretches(m_bitmap, g.recordSize, granule, granule, m_validBytes);
    }
    m_plan = planReads(m_extents, m_validBytes, g.clusterSize, block, skip);
    std::uint64_t planned = 0;
    for (const Read& r : m_plan)
        planned += r.length;
    const std::uint64_t end = (m_validBytes + g.clusterSize - 1) / g.clusterSize * g.clusterSize;
    m_skipped = end - std::min(end, planned);
    for (int s = 0; s < m_options.readsInFlight && issue(s); ++s) {
    }
}

bool MftReader::readInto(int slot, std::uint64_t offset, std::uint32_t bytes)
{
    std::byte* const into = m_slots[static_cast<std::size_t>(slot)].data;
    const std::optional<std::uint32_t> read
        = m_device->begin(slot, offset, into, bytes) ? m_device->end(slot) : std::nullopt;
    return read && *read == bytes;
}

bool MftReader::readRecordZero(std::uint64_t mftStart, std::wstring& error)
{
    const std::uint32_t recordSize = m_geometry.recordSize;
    const std::uint32_t bytes = (recordSize + m_geometry.sectorSize - 1) / m_geometry.sectorSize * m_geometry.sectorSize;
    if (!readInto(0, mftStart, bytes)) {
        error = L"reading MFT record 0 failed, error " + std::to_wstring(::GetLastError());
        return false;
    }
    if (!applyFixups(m_slots[0].data, recordSize)) {
        error = L"MFT record 0 is damaged";
        return false;
    }
    return true;
}

bool MftReader::extentsFrom(const std::byte* record)
{
    std::optional<std::vector<Extent>> runs;
    std::uint64_t clusters = 0;
    forEachAttribute(record, m_geometry.recordSize, [&](std::uint32_t type, const std::byte* attribute, std::size_t length) {
        // The unnamed, non-resident $DATA attribute that starts at the first cluster.
        if (type != kData || runs || length < 0x40 || attribute[8] == std::byte {0} || attribute[9] != std::byte {0}
            || load<std::uint64_t>(attribute + 0x10) != 0)
            return;
        const auto pairsOffset = load<std::uint16_t>(attribute + 0x20);
        if (pairsOffset >= length)
            return;
        clusters = load<std::uint64_t>(attribute + 0x18) + 1; // highest VCN + 1
        runs = decodeRunList({attribute + pairsOffset, length - pairsOffset}, m_geometry.clusterSize);
    });
    // A very fragmented MFT continues its run list in other records: not handled here.
    if (!runs || clusters * m_geometry.clusterSize < m_validBytes) {
        m_error = L"cannot locate the MFT";
        return false;
    }
    m_extents = std::move(*runs);
    return true;
}

std::vector<std::byte> MftReader::readRecord(std::uint32_t number)
{
    // Its bytes in the MFT, through the extents: with clusters smaller than
    // records, in pieces. Each piece is read in whole sectors, through the
    // second buffer (the first holds record 0).
    const std::uint32_t recordSize = m_geometry.recordSize;
    const std::uint32_t sector = m_geometry.sectorSize;
    std::vector<std::byte> record(recordSize);
    std::uint64_t at = std::uint64_t {number} * recordSize;
    std::uint64_t start = 0; // of the extent, in the MFT
    std::size_t done = 0;
    for (const Extent& e : m_extents) {
        while (done < recordSize && at >= start && at < start + e.length) {
            const std::uint64_t n = std::min<std::uint64_t>(recordSize - done, start + e.length - at);
            const std::uint64_t offset = e.offset + (at - start);
            const std::uint64_t first = offset / sector * sector;
            const auto bytes = static_cast<std::uint32_t>((offset + n + sector - 1) / sector * sector - first);
            if (!readInto(1, first, bytes))
                return {};
            std::memcpy(record.data() + done, m_slots[1].data + (offset - first), static_cast<std::size_t>(n));
            done += static_cast<std::size_t>(n);
            at += n;
        }
        start += e.length;
    }
    if (done < recordSize || !applyFixups(record.data(), recordSize))
        return {};
    return record;
}

std::vector<std::byte> MftReader::readRuns(std::span<const Extent> runs, std::uint64_t size)
{
    // Through the second buffer, a block at a time.
    std::vector<std::byte> out;
    const std::uint64_t block = std::max<std::uint64_t>(kBlockBytes, m_geometry.clusterSize);
    out.reserve(static_cast<std::size_t>(size));
    for (const Extent& e : runs) {
        for (std::uint64_t pos = 0; pos < e.length && out.size() < size;) {
            const auto n = static_cast<std::uint32_t>(std::min(block, e.length - pos));
            if (!readInto(1, e.offset + pos, n))
                return {};
            out.insert(out.end(), m_slots[1].data, m_slots[1].data + std::min<std::uint64_t>(n, size - out.size()));
            pos += n;
        }
    }
    if (out.size() < size)
        out.clear();
    return out;
}

std::vector<std::byte> MftReader::bitmapFrom(const std::byte* recordZero)
{
    // The MFT's unnamed $BITMAP attribute, read whole; nothing when it cannot
    // be (m_bitmapNote says why), and then every record is read. A large MFT
    // keeps a list of its attributes in record 0 ($ATTRIBUTE_LIST) and some of
    // them in other records; a long run list is in parts, each in a record of
    // its own.
    const std::uint32_t recordSize = m_geometry.recordSize;
    constexpr std::uint64_t kMaxBytes = std::uint64_t {1} << 32; // of a list or a bitmap: more is not believed
    const auto nonResidentRuns = [&](const std::byte* attribute, std::size_t length) {
        const auto pairsOffset = load<std::uint16_t>(attribute + 0x20);
        return length >= 0x40 && pairsOffset < length
            ? decodeRunList({attribute + pairsOffset, length - pairsOffset}, m_geometry.clusterSize)
            : std::nullopt;
    };

    // Its parts (first VCN, record), from the attribute list; or record 0 alone.
    std::vector<std::pair<std::uint64_t, std::uint32_t>> parts;
    std::optional<std::vector<std::byte>> list;
    forEachAttribute(recordZero, recordSize, [&](std::uint32_t type, const std::byte* attribute, std::size_t length) {
        if (type != kAttributeList || list)
            return;
        if (attribute[8] == std::byte {0}) {
            const auto value = residentValue(attribute, length);
            list.emplace(value.begin(), value.end());
        } else if (const auto runs = nonResidentRuns(attribute, length)) {
            const auto size = load<std::uint64_t>(attribute + 0x30);
            list = size <= kMaxBytes ? readRuns(*runs, size) : std::vector<std::byte>();
        } else {
            list.emplace();
        }
    });
    if (!list) {
        parts.emplace_back(0, 0);
    } else {
        // Entries: type, length, name length, name offset, first VCN, record, id.
        for (std::size_t pos = 0; pos + 0x1A <= list->size();) {
            const std::byte* entry = list->data() + pos;
            const auto entryLength = load<std::uint16_t>(entry + 4);
            if (entryLength < 0x1A || entryLength > list->size() - pos)
                break;
            if (load<std::uint32_t>(entry) == kBitmap && entry[6] == std::byte {0})
                parts.emplace_back(load<std::uint64_t>(entry + 8), recordOf(load<std::uint64_t>(entry + 0x10)));
            pos += entryLength;
        }
        std::sort(parts.begin(), parts.end());
        if (parts.empty()) {
            m_bitmapNote = list->empty() ? L"the attribute list could not be read" : L"not in the attribute list";
            return {};
        }
    }

    std::vector<Extent> runs;
    std::uint64_t size = 0;
    std::uint64_t nextVcn = 0;
    for (const auto& [vcn, number] : parts) {
        std::vector<std::byte> other;
        if (number != 0) {
            other = readRecord(number);
            if (other.empty()) {
                m_bitmapNote = L"record " + std::to_wstring(number) + L" could not be read";
                return {};
            }
        }
        if (vcn != nextVcn) {
            m_bitmapNote = L"a part is missing before VCN " + std::to_wstring(vcn);
            return {};
        }
        if (vcn == 0)
            m_bitmapRecord = number;
        bool found = false;
        std::optional<std::vector<std::byte>> resident;
        forEachAttribute(number != 0 ? other.data() : recordZero, recordSize,
            [&](std::uint32_t type, const std::byte* attribute, std::size_t length) {
                if (type != kBitmap || found || length < 0x18 || attribute[9] != std::byte {0})
                    return;
                if (attribute[8] == std::byte {0}) {
                    const auto value = residentValue(attribute, length);
                    resident.emplace(value.begin(), value.end());
                    found = vcn == 0;
                    return;
                }
                if (length < 0x40 || load<std::uint64_t>(attribute + 0x10) != vcn)
                    return; // another part
                const auto decoded = nonResidentRuns(attribute, length);
                if (!decoded)
                    return;
                if (vcn == 0)
                    size = load<std::uint64_t>(attribute + 0x30); // the first part has the sizes
                runs.insert(runs.end(), decoded->begin(), decoded->end());
                nextVcn = load<std::uint64_t>(attribute + 0x18) + 1;
                found = true;
            });
        if (!found) {
            m_bitmapNote = L"the part at VCN " + std::to_wstring(vcn) + L" is not in record " + std::to_wstring(number);
            return {};
        }
        if (resident) {
            m_bitmapNote = L"in record 0";
            return std::move(*resident);
        }
    }
    if (size == 0 || size > kMaxBytes) {
        m_bitmapNote = L"its size is " + std::to_wstring(size);
        return {};
    }
    std::vector<std::byte> bitmap = readRuns(runs, size);
    if (bitmap.empty()) {
        m_bitmapNote = L"its " + std::to_wstring(runs.size()) + L" runs could not be read";
        return {};
    }
    m_bitmapNote = L"in " + std::to_wstring(parts.size()) + (parts.size() == 1 ? L" part" : L" parts")
        + L", first in record " + std::to_wstring(parts.front().second) + L", " + std::to_wstring(runs.size())
        + L" runs";
    return bitmap;
}

bool MftReader::issue(int slot)
{
    if (m_planned >= m_plan.size())
        return true; // all started
    const Read& r = m_plan[m_planned++];
    Slot& s = m_slots[static_cast<std::size_t>(slot)];
    s.bytes = static_cast<std::uint32_t>(r.length);
    s.at = r.at;
    if (!m_device->begin(slot, r.offset, s.data, s.bytes)) {
        fail(L"reading the MFT");
        return false;
    }
    s.pending = true;
    return true;
}

bool MftReader::next()
{
    m_blockRecords = 0;
    // The records handed out last time are parsed: their slot takes the next read.
    if (m_handedOut >= 0 && !issue(std::exchange(m_handedOut, -1)))
        return false;
    const std::uint32_t recordSize = m_geometry.recordSize;
    while (valid()) {
        const int slot = m_turn;
        Slot& s = m_slots[static_cast<std::size_t>(slot)];
        if (!s.pending)
            return false; // all read
        s.pending = false;
        const std::optional<std::uint32_t> read = m_device->end(slot);
        if (!read || *read != s.bytes) {
            fail(L"reading the MFT");
            return false;
        }
        m_turn = (slot + 1) % static_cast<int>(m_slots.size());
        if (s.carried == 0)
            m_streamPos = s.at; // after a stretch left out, the records go on here
        // Whole records, from the start of one the last read ended with (in front of the data) on.
        std::byte* const begin = s.data - s.carried;
        const std::uint64_t have = s.carried + *read;
        const std::uint64_t left = m_validBytes - std::min(m_validBytes, m_streamPos);
        const std::size_t used = static_cast<std::size_t>(std::min(have, left) / recordSize * recordSize);
        s.carried = 0;
        // Clusters smaller than records: a record can go on in the next read
        // (in the next slot). Its start goes in front of that one's data.
        Slot& following = m_slots[static_cast<std::size_t>(m_turn)];
        if (have < left && used < have && following.pending && following.at == s.at + *read) {
            following.carried = static_cast<std::size_t>(have - used);
            std::memcpy(following.data - following.carried, begin + used, following.carried);
        }
        m_records = begin;
        m_firstRecord = static_cast<std::uint32_t>(m_streamPos / recordSize);
        m_blockRecords = used / recordSize;
        m_streamPos += used;
        if (m_blockRecords > 0) {
            m_handedOut = slot;
            return true;
        }
        if (!issue(slot)) // less than a record: on to the next read
            return false;
    }
    return false;
}

bool MftReader::parse(std::size_t i, FileRecord& out)
{
    return i < m_blockRecords && parseFileRecord(m_records + i * m_geometry.recordSize, m_geometry.recordSize, out);
}

// ---- change journal ----------------------------------------------------------

std::optional<JournalInfo> queryJournal(std::wstring_view root)
{
    const auto query = [&]() -> std::optional<JournalInfo> {
        void* volume = openVolume(root, GENERIC_READ, 0);
        if (!volume)
            return std::nullopt;
        USN_JOURNAL_DATA_V0 data {};
        DWORD bytes = 0;
        const BOOL ok = ::DeviceIoControl(volume, FSCTL_QUERY_USN_JOURNAL, nullptr, 0, &data, sizeof data, &bytes, nullptr);
        const DWORD error = ::GetLastError();
        closeHandle(volume);
        if (!ok) {
            ::SetLastError(error);
            return std::nullopt;
        }
        return JournalInfo {data.UsnJournalID, std::max(data.FirstUsn, data.LowestValidUsn), data.NextUsn};
    };
    // ToolKnit: probing must not create a journal or change volume settings.
    return query();
}

std::int64_t parseUsnRecords(std::span<const std::byte> data, std::vector<UsnRecord>& out)
{
    if (data.size() < sizeof(USN))
        return -1;
    const auto next = load<std::int64_t>(data.data());
    std::size_t pos = sizeof(USN);
    constexpr std::size_t kHeader = 60; // USN_RECORD_V2 up to FileName
    while (data.size() - pos >= kHeader) {
        const std::byte* r = data.data() + pos;
        const auto length = load<std::uint32_t>(r);
        if (length < kHeader || length > data.size() - pos)
            return -1;
        if (load<std::uint16_t>(r + 4) == 2) {
            const auto nameLength = load<std::uint16_t>(r + 56);
            const auto nameOffset = load<std::uint16_t>(r + 58);
            if (std::uint32_t {nameOffset} + nameLength <= length && nameLength % 2 == 0) {
                out.push_back({load<std::uint64_t>(r + 8), load<std::uint64_t>(r + 16), load<std::int64_t>(r + 24),
                    load<std::uint32_t>(r + 40), load<std::uint32_t>(r + 52),
                    {reinterpret_cast<const char16_t*>(r + nameOffset), nameLength / 2u}, load<std::int64_t>(r + 32)});
            }
        }
        pos += length;
    }
    return next;
}

JournalReader::JournalReader(std::wstring_view root, std::uint64_t journalId)
    : m_journalId(journalId)
    , m_buffer(kJournalBufferBytes / sizeof(std::uint64_t))
    , m_overlapped(std::make_unique<OVERLAPPED>())
{
    m_volume = openVolume(root, GENERIC_READ, FILE_FLAG_OVERLAPPED);
    m_event = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

JournalReader::~JournalReader()
{
    cancel();
    closeHandle(m_volume);
    closeHandle(m_event);
}

bool JournalReader::valid() const noexcept
{
    return m_volume && m_event;
}

void JournalReader::start(std::int64_t usn, bool wait)
{
    cancel();
    READ_USN_JOURNAL_DATA_V0 in {};
    in.StartUsn = usn;
    in.ReasonMask = kReasonMask;
    in.ReturnOnlyOnClose = FALSE; // rename records carry the old name only before the close
    in.Timeout = 0;
    in.BytesToWaitFor = wait ? 1 : 0;
    in.UsnJournalID = m_journalId;
    ::ResetEvent(m_event);
    *m_overlapped = OVERLAPPED {};
    m_overlapped->hEvent = m_event;
    m_startError = 0;
    if (::DeviceIoControl(m_volume, FSCTL_READ_USN_JOURNAL, &in, sizeof in, m_buffer.data(), kJournalBufferBytes,
            nullptr, m_overlapped.get())
        || ::GetLastError() == ERROR_IO_PENDING) {
        m_pending = true;
        return;
    }
    m_startError = ::GetLastError();
    ::SetEvent(m_event); // finish() reports the error
}

bool JournalReader::finishRaw(std::span<const std::byte>& data)
{
    data = {};
    if (!m_pending) {
        if (m_startError)
            ::SetLastError(m_startError);
        return false;
    }
    m_pending = false;
    DWORD bytes = 0;
    if (!::GetOverlappedResult(m_volume, m_overlapped.get(), &bytes, TRUE))
        return false;
    data = {reinterpret_cast<const std::byte*>(m_buffer.data()), bytes};
    return true;
}

bool JournalReader::finish(std::vector<UsnRecord>& records, std::int64_t& nextUsn)
{
    records.clear();
    std::span<const std::byte> data;
    if (!finishRaw(data))
        return false;
    const std::int64_t next = parseUsnRecords(data, records);
    if (next < 0)
        return false;
    nextUsn = next;
    return true;
}

void JournalReader::cancel()
{
    if (!m_pending)
        return;
    ::CancelIoEx(m_volume, m_overlapped.get());
    DWORD ignored = 0;
    ::GetOverlappedResult(m_volume, m_overlapped.get(), &ignored, TRUE);
    m_pending = false;
}

// ---- DirectVolumeAccess ----------------------------------------------------------

std::unique_ptr<RecordSource> DirectVolumeAccess::openMft(std::wstring_view root, std::uint32_t, bool)
{
    return std::make_unique<MftReader>(root);
}

std::optional<JournalInfo> DirectVolumeAccess::queryJournal(std::wstring_view root, std::uint32_t)
{
    return ntfs::queryJournal(root);
}

std::unique_ptr<JournalSource> DirectVolumeAccess::openJournal(
    std::wstring_view root, std::uint32_t, std::uint64_t journalId)
{
    return std::make_unique<JournalReader>(root, journalId);
}

void DirectVolumeAccess::closeVolume(std::wstring_view)
{
}

} // namespace ws::ntfs
