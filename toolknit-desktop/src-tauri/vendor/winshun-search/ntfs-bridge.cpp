// Bounded metadata-only adapter; no file content or journal creation endpoints.
#include "Ntfs.h"
#include <windows.h>
#include <limits>
#include <algorithm>

struct TkMftRecord {
    std::uint32_t number;
    std::uint32_t base;
    std::uint64_t parent;
    const char16_t* name;
    std::size_t nameLength;
    std::uint64_t size;
    std::int64_t modified;
    std::uint32_t attributes;
    bool directory;
    bool sizeKnown;
    bool attributeList;
};
using TkMftCallback = bool (*)(void*, const TkMftRecord*);
using TkCancelled = bool (*)(void*);

extern "C" int tk_ntfs_scan(char drive, void* context, TkMftCallback receive, TkCancelled cancelled) noexcept {
    if (drive<'A'||drive>'Z'||!receive||!cancelled) return -1;
    try {
        const wchar_t root[]{static_cast<wchar_t>(drive),L':'};
        ws::ntfs::MftReader reader(std::wstring_view(root,2));
        if (!reader.valid()) return -2;
        ws::ntfs::FileRecord record;
        while (!cancelled(context) && reader.next()) {
            for (std::size_t i=0;i<reader.blockRecords();++i) {
                if ((i%128)==0 && cancelled(context)) return 1;
                if (!reader.parse(i,record)||!record.inUse) continue;
                const auto number=reader.firstRecord()+static_cast<std::uint32_t>(i);
                const auto owner=record.baseRecord?record.baseRecord:number;
                if (owner<16&&owner!=ws::ntfs::kRootRecord) continue;
                for (const auto& name:record.names) {
                    if (name.name.empty()||name.name.size()>255) continue;
                    TkMftRecord item{number,record.baseRecord,name.parent,name.name.data(),name.name.size(),record.size,record.modified,record.attributes,record.directory,record.sizeKnown,record.hasAttributeList};
                    if (!receive(context,&item)) return 1;
                }
                // Attribute-list extension records can own size without a name.
                if (record.names.empty()&&(record.hasAttributeList||(record.baseRecord&&record.sizeKnown))) {
                    TkMftRecord item{number,record.baseRecord,0,nullptr,0,record.size,record.modified,record.attributes,record.directory,record.sizeKnown,record.hasAttributeList};
                    if (!receive(context,&item)) return 1;
                }
            }
        }
        return cancelled(context)?1:reader.valid()?0:-3;
    } catch (...) { return -4; }
}
struct TkJournal {std::uint64_t id;std::int64_t first;std::int64_t next;};
extern "C" bool tk_ntfs_journal(char drive,TkJournal* out) noexcept {
    if(drive<'A'||drive>'Z'||!out)return false;
    try {const wchar_t root[]{static_cast<wchar_t>(drive),L':'};const auto info=ws::ntfs::queryJournal(std::wstring_view(root,2));
        if(!info)return false;*out={info->id,info->firstUsn,info->nextUsn};return true;
    }catch(...){return false;}
}
struct TkChange {std::uint64_t file;std::uint64_t parent;const char16_t* name;std::size_t nameLength;std::uint32_t reason;std::uint32_t attributes;};
using TkChangeCallback = bool (*)(void*,const TkChange*);
extern "C" int tk_ntfs_changes(char drive,std::uint64_t journalId,std::int64_t start,std::int64_t target,
    void* context,TkChangeCallback receive,TkCancelled cancelled,std::int64_t* end) noexcept {
    if(drive<'A'||drive>'Z'||!receive||!cancelled||!end||start<0||target<start)return -1;
    try {
        const wchar_t root[]{static_cast<wchar_t>(drive),L':'};
        ws::ntfs::JournalReader reader(std::wstring_view(root,2),journalId);
        if(!reader.valid())return -2;
        std::vector<ws::ntfs::UsnRecord> records;auto cursor=start;std::uint64_t count=0;
        while(cursor<target&&!cancelled(context)){
            reader.start(cursor,false);const auto until=::GetTickCount64()+30000;
            while(::WaitForSingleObject(reader.event(),100)==WAIT_TIMEOUT){if(cancelled(context)||::GetTickCount64()>until){reader.cancel();return 1;}}
            std::int64_t next=cursor;if(!reader.finish(records,next)||next<cursor)return -3;
            for(const auto& r:records){
                // Keep both history and replay on the caller's frozen endpoint.
                // A read can include newer records; leave those for next time.
                if(r.usn<start||r.usn>=target)continue;
                if(++count>1000000)return -3;
                if(cancelled(context))return 1;
                if(r.name.empty()||r.name.size()>255)continue;
                TkChange value{r.file,r.parent,r.name.data(),r.name.size(),r.reason,r.attributes};
                if(!receive(context,&value))return 1;
            }
            if(next==cursor&&cursor<target)return -3;cursor=std::min(next,target);
        }
        *end=cursor;return cancelled(context)?1:0;
    }catch(...){return -4;}
}
