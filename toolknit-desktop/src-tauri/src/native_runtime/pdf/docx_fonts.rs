// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
use super::failure;
use quick_xml::events::Event;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const MAX_FONT_BYTES: u64 = 12 * 1024 * 1024;
pub(super) const MAX_TOTAL_FONT_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const MAX_FONTS: usize = 32;
const WORD_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

pub(super) fn font_part(name: &str) -> bool {
    name.strip_prefix("word/fonts/font")
        .and_then(|value| value.strip_suffix(".odttf"))
        .is_some_and(|number| {
            !number.is_empty()
                && number.len() <= 2
                && !number.starts_with('0')
                && number.bytes().all(|c| c.is_ascii_digit())
        })
}

fn invalid<T>() -> Result<T, String> {
    Err(failure("output-invalid"))
}

fn attrs(
    element: &quick_xml::events::BytesStart<'_>,
    reader: &quick_xml::Reader<&[u8]>,
) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|_| failure("output-invalid"))?;
        let key = std::str::from_utf8(attribute.key.as_ref())
            .map_err(|_| failure("output-invalid"))?
            .to_owned();
        let value = attribute
            .decoded_and_normalized_value(quick_xml::XmlVersion::Explicit1_0, reader.decoder())
            .map_err(|_| failure("output-invalid"))?
            .into_owned();
        if values.insert(key, value).is_some() {
            return invalid();
        }
    }
    Ok(values)
}

fn alias(name: &str) -> bool {
    name.strip_prefix("TKPdf")
        .or_else(|| name.strip_prefix("TKInk"))
        .is_some_and(|suffix| {
            suffix.len() == 24
                && suffix
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
}

fn font_key(text: &str) -> Result<[u8; 16], String> {
    let guid = text
        .strip_prefix('{')
        .and_then(|text| text.strip_suffix('}'))
        .ok_or_else(|| failure("output-invalid"))?;
    if guid.len() != 36 || [8, 13, 18, 23].iter().any(|&i| guid.as_bytes()[i] != b'-') {
        return invalid();
    }
    let compact: String = guid.chars().filter(|&c| c != '-').collect();
    if compact.len() != 32 || !compact.bytes().all(|c| c.is_ascii_hexdigit()) {
        return invalid();
    }
    let mut key = [0_u8; 16];
    hex::decode_to_slice(compact, &mut key).map_err(|_| failure("output-invalid"))?;
    key.reverse();
    Ok(key)
}

pub(super) struct Binding {
    key: [u8; 16],
    name: String,
}

/// Accept only our bounded document-owned font parts, bound to an actual
/// fontTable entry and an internal font relationship. No orphan binary parts.
pub(super) fn bindings(
    table: &[u8],
    relationships: &[u8],
    parts: &BTreeSet<String>,
) -> Result<BTreeMap<String, Binding>, String> {
    if table.len() > 256 * 1024 || relationships.len() > 64 * 1024 {
        return Err(failure("output-large"));
    }
    let mut reader = quick_xml::Reader::from_reader(relationships);
    let mut targets = BTreeMap::new();
    loop {
        match reader.read_event().map_err(|_| failure("output-invalid"))? {
            Event::Start(element) | Event::Empty(element)
                if element.local_name().as_ref() == b"Relationship" =>
            {
                let attributes = attrs(&element, &reader)?;
                let id = attributes
                    .get("Id")
                    .filter(|id| !id.is_empty() && id.len() <= 64)
                    .ok_or_else(|| failure("output-invalid"))?;
                let target = attributes
                    .get("Target")
                    .ok_or_else(|| failure("output-invalid"))?;
                let path = format!("word/{target}");
                if attributes.get("Type").map(String::as_str) != Some(&format!("{REL_NS}/font"))
                    || attributes
                        .get("TargetMode")
                        .is_some_and(|mode| mode != "Internal")
                    || !font_part(&path)
                    || !parts.contains(&path)
                    || targets.len() >= MAX_FONTS
                    || targets.insert(id.clone(), path).is_some()
                {
                    return invalid();
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut reader = quick_xml::Reader::from_reader(table);
    let mut current = None;
    let mut result = BTreeMap::new();
    let mut faces = BTreeSet::new();
    let mut root = false;
    loop {
        match reader.read_event().map_err(|_| failure("output-invalid"))? {
            Event::Start(element) | Event::Empty(element) => {
                let local = element.local_name();
                if local.as_ref() == b"fonts" {
                    let attributes = attrs(&element, &reader)?;
                    if root
                        || element.name().as_ref() != b"w:fonts"
                        || attributes.get("xmlns:w").map(String::as_str) != Some(WORD_NS)
                        || attributes.get("xmlns:r").map(String::as_str) != Some(REL_NS)
                    {
                        return invalid();
                    }
                    root = true;
                } else if local.as_ref() == b"font" {
                    if current.is_some() || element.name().as_ref() != b"w:font" {
                        return invalid();
                    }
                    let attributes = attrs(&element, &reader)?;
                    current = attributes.get("w:name").cloned();
                    if current.is_none() {
                        return invalid();
                    }
                    if table.get(reader.buffer_position().saturating_sub(2) as usize) == Some(&b'/')
                    {
                        current = None;
                    }
                } else if local.as_ref().starts_with(b"embed") {
                    let name = current
                        .as_ref()
                        .filter(|name| alias(name))
                        .ok_or_else(|| failure("output-invalid"))?;
                    if ![
                        b"w:embedRegular".as_slice(),
                        b"w:embedBold",
                        b"w:embedItalic",
                        b"w:embedBoldItalic",
                    ]
                    .contains(&element.name().as_ref())
                    {
                        return invalid();
                    }
                    let attributes = attrs(&element, &reader)?;
                    let id = attributes
                        .get("r:id")
                        .ok_or_else(|| failure("output-invalid"))?;
                    let path = targets.get(id).ok_or_else(|| failure("output-invalid"))?;
                    let key = font_key(
                        attributes
                            .get("w:fontKey")
                            .ok_or_else(|| failure("output-invalid"))?,
                    )?;
                    if !faces.insert((name.clone(), local.as_ref().to_vec()))
                        || result
                            .insert(
                                path.clone(),
                                Binding {
                                    key,
                                    name: name.clone(),
                                },
                            )
                            .is_some()
                    {
                        return invalid();
                    }
                }
            }
            Event::End(element) if element.local_name().as_ref() == b"font" => {
                current = None;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root || current.is_some() || result.len() != targets.len() || result.len() != parts.len() {
        return invalid();
    }
    Ok(result)
}

fn u16_at(bytes: &[u8], offset: usize) -> Result<u16, String> {
    Ok(u16::from_be_bytes(
        bytes
            .get(offset..offset + 2)
            .ok_or_else(|| failure("output-invalid"))?
            .try_into()
            .unwrap(),
    ))
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    Ok(u32::from_be_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or_else(|| failure("output-invalid"))?
            .try_into()
            .unwrap(),
    ))
}
fn checksum(bytes: &[u8], head: bool) -> u32 {
    bytes
        .chunks(4)
        .enumerate()
        .fold(0_u32, |sum, (index, chunk)| {
            if head && index == 2 {
                return sum;
            }
            let mut word = [0_u8; 4];
            word[..chunk.len()].copy_from_slice(chunk);
            sum.wrapping_add(u32::from_be_bytes(word))
        })
}

fn validate_ttf(bytes: &[u8], name: &str) -> Result<(), String> {
    if bytes.len() < 12
        || bytes.len() as u64 > MAX_FONT_BYTES
        || u32_at(bytes, 0)? != 0x10000
        || checksum(bytes, false) != 0xb1b0afba
    {
        return invalid();
    }
    let count = usize::from(u16_at(bytes, 4)?);
    let directory = 12 + count * 16;
    if !(5..=32).contains(&count) || directory > bytes.len() {
        return invalid();
    }
    let mut tables = BTreeMap::new();
    let mut ranges = Vec::new();
    for at in (12..directory).step_by(16) {
        let tag = &bytes[at..at + 4];
        let offset = u32_at(bytes, at + 8)? as usize;
        let length = u32_at(bytes, at + 12)? as usize;
        if !tag
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || *c == b' ' || *c == b'/')
            || offset < directory
            || offset % 4 != 0
            || offset > bytes.len()
            || length > bytes.len() - offset
            || tables.contains_key(tag)
            || ranges
                .iter()
                .any(|&(start, end)| length > 0 && offset < end && offset + length > start)
        {
            return invalid();
        }
        let data = &bytes[offset..offset + length];
        if checksum(data, tag == b"head") != u32_at(bytes, at + 4)? {
            return invalid();
        }
        tables.insert(tag, data);
        ranges.push((offset, offset + length));
    }
    let table = |tag: &[u8; 4], min: usize| -> Result<&[u8], String> {
        tables
            .get(tag.as_slice())
            .copied()
            .filter(|data| data.len() >= min)
            .ok_or_else(|| failure("output-invalid"))
    };
    for tag in [
        b"SVG ", b"CBDT", b"CBLC", b"sbix", b"fvar", b"gvar", b"CFF ", b"CFF2",
    ] {
        if tables.contains_key(tag.as_slice()) {
            return invalid();
        }
    }
    let head = table(b"head", 54)?;
    let os2 = table(b"OS/2", 78)?;
    let maxp = table(b"maxp", 32)?;
    let hhea = table(b"hhea", 36)?;
    let flags = u16_at(os2, 8)?;
    let glyphs = usize::from(u16_at(maxp, 4)?);
    let metrics = usize::from(u16_at(hhea, 34)?);
    let format = u16_at(head, 50)?;
    if flags & !0x030e != 0
        || name.starts_with("TKInk")
            && (flags != 0 || bytes.len() > 2 * 1024 * 1024 || glyphs > 514)
        || flags & (2 | 0x100 | 0x200) != 0
        || flags != 0 && flags & 8 == 0
        || u32_at(head, 12)? != 0x5f0f3cf5
        || !(16..=16384).contains(&u16_at(head, 18)?)
        || u32_at(maxp, 0)? != 0x10000
        || glyphs < 2
        || metrics < 1
        || metrics > glyphs
        || format > 1
    {
        return invalid();
    }
    table(b"hmtx", metrics * 4 + (glyphs - metrics) * 2)?;
    table(b"post", 32)?;
    table(b"cmap", 12)?;
    let glyf = table(b"glyf", 0)?;
    let loca = table(b"loca", (glyphs + 1) * if format == 1 { 4 } else { 2 })?;
    let mut previous = 0;
    for index in 0..=glyphs {
        let offset = if format == 1 {
            u32_at(loca, index * 4)? as usize
        } else {
            usize::from(u16_at(loca, index * 2)?) * 2
        };
        if offset < previous || offset > glyf.len() {
            return invalid();
        }
        previous = offset;
    }
    let names = table(b"name", 6)?;
    let records = usize::from(u16_at(names, 2)?);
    let start = usize::from(u16_at(names, 4)?);
    if u16_at(names, 0)? != 0 || records > 512 || start < 6 + records * 12 || start > names.len() {
        return invalid();
    }
    let mut family = false;
    for at in (6..6 + records * 12).step_by(12) {
        let platform = u16_at(names, at)?;
        let id = u16_at(names, at + 6)?;
        let length = usize::from(u16_at(names, at + 8)?);
        let offset = start + usize::from(u16_at(names, at + 10)?);
        let text = names
            .get(offset..offset + length)
            .ok_or_else(|| failure("output-invalid"))?;
        if id == 1 || id == 16 {
            let expected: Vec<u8> = match platform {
                1 => name.bytes().collect(),
                0 | 3 => name.bytes().flat_map(|c| [0, c]).collect(),
                _ => return invalid(),
            };
            if text != expected {
                return invalid();
            }
            family = true;
        }
    }
    if !family {
        return invalid();
    }
    Ok(())
}

pub(super) fn validate(data: &mut [u8], binding: &Binding) -> Result<(), String> {
    if data.len() < 32 {
        return invalid();
    }
    for (index, value) in data[..32].iter_mut().enumerate() {
        *value ^= binding.key[index % 16];
    }
    validate_ttf(data, &binding.name)
}

#[cfg(test)]
mod tests {
    use super::*;
    const NAME: &str = "TKPdf0123456789abcdef01234567";
    const KEY: &str = "{00112233-4455-6677-8899-AABBCCDDEEFF}";

    // A structural fixture, not a glyph-rendering or font-license fixture.
    fn ttf(flags: u16, bad_loca: bool) -> Vec<u8> {
        ttf_named(flags, bad_loca, NAME)
    }

    fn ttf_named(flags: u16, bad_loca: bool, name: &str) -> Vec<u8> {
        let mut tables: BTreeMap<&[u8; 4], Vec<u8>> = BTreeMap::new();
        let mut head = vec![0; 54];
        head[12..16].copy_from_slice(&0x5f0f3cf5_u32.to_be_bytes());
        head[18..20].copy_from_slice(&1000_u16.to_be_bytes());
        let mut os2 = vec![0; 78];
        os2[8..10].copy_from_slice(&flags.to_be_bytes());
        let mut maxp = vec![0; 32];
        maxp[..4].copy_from_slice(&0x10000_u32.to_be_bytes());
        maxp[4..6].copy_from_slice(&2_u16.to_be_bytes());
        let mut hhea = vec![0; 36];
        hhea[34..36].copy_from_slice(&1_u16.to_be_bytes());
        let mut names = vec![0; 18];
        names[2..4].copy_from_slice(&1_u16.to_be_bytes());
        names[4..6].copy_from_slice(&18_u16.to_be_bytes());
        names[6..8].copy_from_slice(&3_u16.to_be_bytes());
        names[12..14].copy_from_slice(&1_u16.to_be_bytes());
        names[14..16].copy_from_slice(&((name.len() * 2) as u16).to_be_bytes());
        names.extend(name.bytes().flat_map(|c| [0, c]));
        tables.insert(b"head", head);
        tables.insert(b"OS/2", os2);
        tables.insert(b"maxp", maxp);
        tables.insert(b"hhea", hhea);
        tables.insert(b"name", names);
        tables.insert(b"hmtx", vec![0; 6]);
        tables.insert(b"glyf", vec![0; 10]);
        tables.insert(
            b"loca",
            if bad_loca {
                vec![0, 0, 0, 100, 0, 0]
            } else {
                vec![0; 6]
            },
        );
        tables.insert(b"post", vec![0; 32]);
        tables.insert(b"cmap", vec![0; 12]);
        let mut output = vec![0; 12 + tables.len() * 16];
        output[..4].copy_from_slice(&0x10000_u32.to_be_bytes());
        output[4..6].copy_from_slice(&(tables.len() as u16).to_be_bytes());
        let mut head_offset = 0;
        for (index, (tag, bytes)) in tables.iter().enumerate() {
            let at = 12 + index * 16;
            let offset = output.len();
            if *tag == b"head" {
                head_offset = offset;
            }
            output[at..at + 4].copy_from_slice(*tag);
            output[at + 4..at + 8].copy_from_slice(&checksum(bytes, false).to_be_bytes());
            output[at + 8..at + 12].copy_from_slice(&(offset as u32).to_be_bytes());
            output[at + 12..at + 16].copy_from_slice(&(bytes.len() as u32).to_be_bytes());
            output.extend(bytes);
            output.resize(output.len().div_ceil(4) * 4, 0);
        }
        let adjustment = 0xb1b0afba_u32.wrapping_sub(checksum(&output, false));
        output[head_offset + 8..head_offset + 12].copy_from_slice(&adjustment.to_be_bytes());
        output
    }

    fn xml() -> (String, String, BTreeSet<String>) {
        (
            format!(
                r#"<w:fonts xmlns:w="{WORD_NS}" xmlns:r="{REL_NS}"><w:font w:name="{NAME}"><w:embedRegular r:id="rId1" w:fontKey="{KEY}"/></w:font></w:fonts>"#
            ),
            format!(
                r#"<Relationships><Relationship Id="rId1" Type="{REL_NS}/font" Target="fonts/font1.odttf"/></Relationships>"#
            ),
            BTreeSet::from(["word/fonts/font1.odttf".into()]),
        )
    }

    #[test]
    fn embedded_font_permissions_structure_and_original_guid_order() {
        assert_eq!(
            font_key(KEY).unwrap(),
            [255, 238, 221, 204, 187, 170, 153, 136, 119, 102, 85, 68, 51, 34, 17, 0]
        );
        for bad in [
            "00112233-4455-6677-8899-AABBCCDDEEFF",
            "{00112233_4455-6677-8899-AABBCCDDEEFF}",
            "{00112233-4455-6677-8899-AABBCCDDEEFG}",
        ] {
            assert!(font_key(bad).is_err());
        }
        let binding = Binding {
            key: font_key(KEY).unwrap(),
            name: NAME.into(),
        };
        for flags in [0, 8, 12] {
            let mut data = ttf(flags, false);
            validate_ttf(&data, NAME).unwrap();
            for (index, byte) in data[..32].iter_mut().enumerate() {
                *byte ^= binding.key[index % 16];
            }
            validate(&mut data, &binding).unwrap();
        }
        for flags in [2, 4, 6, 10, 0x100, 0x108, 0x200, 0x208, 0x8000] {
            assert!(validate_ttf(&ttf(flags, false), NAME).is_err());
        }
        assert!(validate_ttf(&ttf(0, true), NAME).is_err());
        assert!(validate_ttf(&ttf(0, false), "TKPdf000000000000000000000000").is_err());
        let mut corrupt = ttf(0, false);
        let last = corrupt.len() - 1;
        corrupt[last] ^= 1;
        assert!(validate_ttf(&corrupt, NAME).is_err());
        assert!(validate(&mut [0; 31], &binding).is_err());
        assert!(validate(&mut vec![0; 1024], &binding).is_err());
        assert!(validate(&mut vec![0; MAX_FONT_BYTES as usize + 1], &binding).is_err());
    }

    #[test]
    fn embedded_font_relationships_must_be_complete_unique_and_internal() {
        let (table, relationships, parts) = xml();
        assert_eq!(
            bindings(table.as_bytes(), relationships.as_bytes(), &parts)
                .unwrap()
                .len(),
            1
        );
        for (from, to) in [
            ("rId1", "rId2"),
            (KEY, "{bad}"),
            (NAME, "Arial"),
            ("w:embedRegular", "x:embedRegular"),
            (WORD_NS, "https://invalid.test/word"),
        ] {
            assert!(
                bindings(
                    table.replace(from, to).as_bytes(),
                    relationships.as_bytes(),
                    &parts
                )
                .is_err(),
                "{from}"
            );
        }
        for modified in [
            relationships.replace("fonts/font1.odttf", "../fonts/font1.odttf"),
            relationships.replace("/font\"", "/image\""),
            relationships.replace("Target=", "TargetMode=\"External\" Target="),
            relationships.replace(
                "</Relationships>",
                &format!(
                    "{}{}",
                    &relationships[15..relationships.len() - 16],
                    "</Relationships>"
                ),
            ),
        ] {
            assert!(bindings(table.as_bytes(), modified.as_bytes(), &parts).is_err());
        }
        let mut orphan = parts.clone();
        orphan.insert("word/fonts/font2.odttf".into());
        assert!(bindings(table.as_bytes(), relationships.as_bytes(), &orphan).is_err());
        assert!(bindings(table.as_bytes(), relationships.as_bytes(), &BTreeSet::new()).is_err());
        let duplicate = table.replace(
            "</w:font>",
            &format!(r#"<w:embedBold r:id="rId1" w:fontKey="{KEY}"/></w:font>"#),
        );
        assert!(bindings(duplicate.as_bytes(), relationships.as_bytes(), &parts).is_err());
        for path in [
            "word/fonts/font0.odttf",
            "word/fonts/font01.odttf",
            "word/fonts/font1.ttf",
            "word/fonts/../font1.odttf",
            "word/media/font1.odttf",
            "word/fonts/font1.odttf.exe",
        ] {
            assert!(!font_part(path));
        }
        assert!(font_part("word/fonts/font32.odttf"));
    }

    #[test]
    fn generated_ocr_faces_use_a_distinct_name_and_zero_original_permission_flags() {
        let name = "TKInk0123456789abcdef01234567";
        assert!(alias(name));
        validate_ttf(&ttf_named(0, false, name), name).unwrap();
        for flags in [2, 4, 8, 12, 0x100, 0x200] {
            assert!(validate_ttf(&ttf_named(flags, false, name), name).is_err());
        }
        assert!(validate_ttf(&ttf(0, false), name).is_err());
        assert!(validate_ttf(&ttf_named(0, false, name), NAME).is_err());
        let (table, relationships, parts) = xml();
        assert!(bindings(
            table.replace(NAME, name).as_bytes(),
            relationships.as_bytes(),
            &parts
        )
        .is_ok());
        for invalid in [
            "TKInk",
            "TKInk0123456789abcdef0123456g",
            "TKInk0123456789abcdef012345678",
            "TKInk../font",
        ] {
            assert!(!alias(invalid));
        }
    }
}
