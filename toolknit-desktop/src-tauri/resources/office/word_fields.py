"""Bounded internal Writer updates. Never call document or field-collection refresh."""
import hashlib

MAX_FIELDS = 20000
MAX_INDEXES = 128
MAX_INDEX_TEXT = 2 * 1024 * 1024
MAX_PASSES = 3
INTERNAL_FIELDS = frozenset(("PageNumber", "PageCount", "GetReference", "Chapter", "ReferencePageGet", "ReferencePageSet"))


class FieldUpdateError(Exception):
    pass


def field_kind(field):
    for service in field.getSupportedServiceNames():
        prefix, _, kind = service.rpartition(".")
        if prefix.lower() == "com.sun.star.text.textfield" and kind in INTERNAL_FIELDS:
            return kind
    return None


def is_internal_index(index, document):
    if index.supportsService("com.sun.star.text.ContentIndex"):
        return True
    if index.supportsService("com.sun.star.text.DocumentIndex"):
        # Writer's alphabetical index can use an external concordance file.
        # Do not clear its URL or update the index when its source is unknown.
        try:
            return document.getPropertyValue("IndexAutoMarkFileURL") == ""
        except Exception:
            return False
    # Word TOC \c imports as an IllustrationsIndex even for table captions.
    # Restrict the extra refresh path to indexes driven by document-local labels.
    return (index.supportsService("com.sun.star.text.IllustrationsIndex")
            and index.getPropertyValue("CreateFromLabels") is True)


def collect_internal(document):
    fields, skipped = [], 0
    enumeration = document.getTextFields().createEnumeration()
    count = 0
    while enumeration.hasMoreElements():
        count += 1
        if count > MAX_FIELDS:
            raise FieldUpdateError("field-update-limit")
        field = enumeration.nextElement()
        if field_kind(field):
            fields.append(field)
        else:
            skipped += 1
    indexes, skipped_indexes = [], 0
    collection = document.getDocumentIndexes()
    if collection.getCount() > MAX_INDEXES:
        raise FieldUpdateError("field-update-limit")
    for index in range(collection.getCount()):
        item = collection.getByIndex(index)
        if is_internal_index(item, document):
            indexes.append(item)
        else:
            skipped_indexes += 1
    return fields, skipped, indexes, skipped_indexes


def refresh_internal_fields(document):
    """Update only known internal types and require pagination/TOC convergence.

    The importer may already recalculate some dynamic fields even in NO_UPDATE
    mode. This option adds no update call to dates, file names, DDE, databases,
    linked sections or unknown field types. Its status never contains text.
    """
    try:
        previous = None
        for attempt in range(1, MAX_PASSES + 1):
            fields, skipped, indexes, skipped_indexes = collect_internal(document)
            summary = {"enabled": True, "fields": len(fields), "indexes": len(indexes),
                       "skippedFields": skipped, "skippedIndexes": skipped_indexes,
                       "passes": attempt, "stabilized": True}
            if not fields and not indexes:
                summary["passes"] = 0
                return summary
            for field in fields:
                field.update()
            for index in indexes:
                index.update()
            # XRenderable forces a layout pass without exporting or dispatching
            # UpdateAll/UpdateFields, which could refresh external content.
            document.getRendererCount(document, ())
            for field in fields:
                field.update()
            pages = document.getRendererCount(document, ())
            digest, total = hashlib.sha256(), 0
            for index in indexes:
                text = index.getAnchor().getString()
                total += len(text)
                if total > MAX_INDEX_TEXT:
                    raise FieldUpdateError("field-update-limit")
                encoded = text.encode("utf-8")
                digest.update(len(encoded).to_bytes(8, "big"))
                digest.update(encoded)
            signature = pages, digest.digest()
            summary["pages"] = pages
            if signature == previous:
                return summary
            previous = signature
        raise FieldUpdateError("field-update-unstable")
    except FieldUpdateError:
        raise
    except Exception:
        # UNO exceptions can contain document names, paths and field contents.
        raise FieldUpdateError("field-update-failed") from None
