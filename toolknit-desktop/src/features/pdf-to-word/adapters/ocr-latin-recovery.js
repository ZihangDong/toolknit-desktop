// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { paintSourceWordRun, sameOtherSourceRuns, sourceOwnedWordPlan } from "./source-owned-scan-fit.js";
/** Recover only visually distinguishable Latin confusions in independently
 * owned OCR prose. Existing source pixels, recognition confidence and page
 * allowance stay unchanged. Font witnesses, isolated full-line ink, complete
 * rival comparison and the actual writer plan all precede atomic binding.
 * Native text, table cells, unknown fonts and ambiguous glyphs retain spelling.
 */
function refineOcrLatinCharacters(createCanvas, prepared, data) {
	const scene = prepared?.scene, budget = data?.budget, check = data?.check || (() => {});
	check();
	const rectOK = (r) => r && [
		"x",
		"y",
		"width",
		"height"
	].every((k) => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
	if (typeof createCanvas !== "function" || !prepared?.changed || !scene || !Array.isArray(scene.items) || scene.items.length > 2e4 || scene.items.some((item) => !item || typeof item !== "object") || !Array.isArray(scene.sources) || scene.sources.length > 2e4 || scene.sources.some((source) => !source || typeof source.id !== "string") || !Number.isFinite(scene.width + scene.height) || scene.width <= 0 || scene.height <= 0 || !(data.pixels instanceof Uint8ClampedArray) || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || data.width < 1 || data.height < 1 || data.width * data.height > 16e6 || data.pixels.length !== data.width * data.height * 4 || !budget || !Number.isSafeInteger(budget.remaining) || budget.remaining < 1 || budget.remaining > 1e5 || !Number.isSafeInteger(budget.pixelsRemaining) || budget.pixelsRemaining < 1 || budget.pixelsRemaining > 4e6) return prepared;
	const choices = {
		S: ["S", "5"],
		"5": ["5", "S"],
		"'": [
			"'",
			"‘",
			"’",
			"`"
		],
		"\"": [
			"\"",
			"“",
			"”"
		],
		e: ["e", "E"],
		E: ["E", "e"],
		I: [
			"I",
			"l",
			"|"
		],
		l: [
			"l",
			"I",
			"L",
			"|"
		],
		L: ["L", "l"],
		O: ["O", "0"],
		"0": ["0", "O"],
		c: [
			"c",
			"C",
			"¢"
		],
		C: [
			"C",
			"c",
			"¢"
		],
		"×": ["×", "x"],
		"《": ["《", "«"],
		"》": ["》", "»"]
	};
	for (const c of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") choices[c] = [.../* @__PURE__ */ new Set([
		...choices[c] || [],
		c,
		c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
	])];
	choices["@"] = [
		"@",
		"®",
		"©"
	];
	const { pixels, width, height } = data, sx = width / scene.width, sy = height / scene.height;
	const med = (a) => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)], walk = (o, out = []) => {
		if (Array.isArray(o)) for (const x of o) walk(x, out);
		else if (o && typeof o === "object") {
			if (o.type === "text") out.push(o);
			for (const k of [
				"header",
				"footer",
				"blocks",
				"items",
				"lines",
				"columns",
				"cells"
			]) if (o[k]) walk(o[k], out);
		}
		return out;
	};
	const allItems = walk(scene), items = scene.items.filter((i) => i.type === "text"), all = allItems.flatMap((i) => i.words || []);
	if (all.length > 2e4) return prepared;
	const sourceMap = new Map(scene.sources.map((s) => [s.id, s]));
	if (sourceMap.size !== scene.sources.length) return prepared;
	let canvas, metricCanvas;
	try {
		canvas = createCanvas(1, 1);
		metricCanvas = createCanvas(1, 1);
		const ctx = canvas.getContext("2d", { willReadFrequently: true }), measure = metricCanvas.getContext("2d");
		if (!ctx || !measure) return prepared;
		const wordPlan = (item, word, replacement, planScene = scene) => {
			try {
				return sourceOwnedWordPlan(planScene, item, word, replacement, measure);
			} catch (error) {
				check();
				if (error?.code === "layout-quality") return null;
				throw error;
			}
		};
		const faceCache = /* @__PURE__ */ new Map();
		const familyVerified = (font, bold) => {
			const key = font + ":" + bold;
			if (faceCache.has(key)) return faceCache.get(key);
			const witness = (family) => {
				measure.font = `${bold ? "bold " : ""}1000px "${family}"`;
				measure.fontKerning = "none";
				return [
					"A",
					"g",
					"0"
				].flatMap((c) => {
					const m = measure.measureText(c);
					return [
						m.width,
						m.actualBoundingBoxLeft,
						m.actualBoundingBoxRight,
						m.actualBoundingBoxAscent,
						m.actualBoundingBoxDescent
					];
				});
			};
			if (!spend(1)) return false;
			const expected = witness(font);
			let valid = expected.every(Number.isFinite) && expected.some((x) => x > 0);
			for (const other of [
				"Arial",
				"Calibri",
				"Cambria",
				"Times New Roman"
			]) if (other !== font) {
				if (!spend(1)) {
					valid = false;
					break;
				}
				const observed = witness(other);
				if (expected.every((n, i) => Math.abs(n - observed[i]) < 1e-6)) {
					valid = false;
					break;
				}
			}
			faceCache.set(key, valid);
			return valid;
		};
		let probes = 0, originalPlan;
		const records = [], inputs = [];
		const spend = (n) => {
			check();
			if (!Number.isSafeInteger(n) || n < 1 || n > budget.pixelsRemaining || budget.remaining < 1) return false;
			budget.pixelsRemaining -= n;
			budget.remaining--;
			return true;
		};
		const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
		for (const item of items) {
			if (!rectOK(item.rect) || typeof item.text !== "string" || item.text.length > 8e3 || !Array.isArray(item.words) || item.words.length > 120 || item.words.length < 5 || item.ocrCorrections != null && !Array.isArray(item.ocrCorrections) || item.ocrCorrections?.length > 128 || !item.words.every((w) => w && typeof w.text === "string" && rectOK(w.rect) && ["size", "baseline", "confidence"].every((key) => Number.isFinite(w[key])) && w.confidence >= 0 && w.confidence <= 1) || item.sourceIds?.length !== 1 || sourceMap.get(item.sourceIds[0])?.disposition !== "editable" || sourceMap.get(item.sourceIds[0])?.text !== item.text || [...item.text].some((character) => /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)) || !item.words?.every((w) => [...w.text].length === 1) || item.words.map((w) => w.text).join("") !== item.text.replace(/\s/gu, "") || !item.ocr || item.ocrNative || item.raster || item.italic || item.role === "math" || item.fontAssetId || ![
				"Calibri",
				"Arial",
				"Cambria",
				"Times New Roman"
			].includes(item.font) || !(Number.isFinite(item.ocrFontScore) && item.ocrFontScore >= .7 && item.ocrFontScore <= 1)) continue;
			const anchors = (item.words || []).filter((w) => w.font === item.font && !w.fontAssetId && !w.italic && Boolean(w.bold ?? item.bold) === Boolean(item.bold) && /^[ABDEFGHJKMNPQRSTUVWXYZ123456789]$/.test(w.text) && w.confidence >= .8 && Number.isFinite(w.ocrGlyphScore) && w.ocrGlyphScore >= .78 && w.ocrGlyphScore <= 1 && w.preciseInk);
			if (anchors.length < 3 || !familyVerified(item.font, !!item.bold)) continue;
			const nominal = Math.round(med(anchors.map((w) => w.size)) * 2) / 2, baseline = med(anchors.map((w) => w.baseline));
			if (nominal < 5 || nominal > 40 || anchors.some((w) => Math.abs(w.size - nominal) > nominal * .12 || Math.abs(w.baseline - baseline) > .65)) continue;
			for (const [index, word] of item.words.entries()) if (choices[word.text] && !word.fontAssetId && !word.italic && word.preciseInk && !word.ocrRuling && word.confidence >= .4 && Boolean(word.bold ?? item.bold) === Boolean(item.bold) && (word.font === item.font || /^[《》]$/u.test(word.text) && word.font === "Microsoft YaHei")) inputs.push({
				item,
				word,
				index,
				nominal,
				baseline,
				priority: Math.abs(Math.log(word.size / nominal)) + (word.text === "\"" ? .5 : 0)
			});
		}
		inputs.sort((a, b) => b.priority - a.priority);
		function dil(mask, w, h) {
			const out = new Uint8Array(mask.length);
			for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) out[(y + dy) * w + x + dx] = 1;
			}
			return out;
		}
		for (const { item, word, index, nominal, baseline } of inputs) {
			check();
			if (probes >= 4096 || records.length >= 128 || budget.pixelsRemaining < 1) break;
			const r = word.rect, pad = .6, x = Math.max(0, Math.floor((r.x - pad) * sx)), y = Math.max(0, Math.floor((Math.min(r.y, item.rect.y) - pad) * sy)), right = Math.min(width, Math.ceil((r.x + r.width + pad) * sx)), bottom = Math.min(height, Math.ceil((Math.max(r.y + r.height, item.rect.y + item.rect.height) + pad) * sy)), w = right - x, h = bottom - y;
			if (w < 3 || h < 3 || w > 128 || h > 128 || !spend(w * h)) continue;
			const mask = new Uint8Array(w * h);
			let ink = 0, bx = w, by = h, br = 0, bb = 0, border = false, color = false;
			for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
				const at = ((y + yy) * width + x + xx) * 4, lo = Math.min(pixels[at], pixels[at + 1], pixels[at + 2]);
				if (lo >= 180) continue;
				mask[yy * w + xx] = 1;
				ink++;
				bx = Math.min(bx, xx);
				by = Math.min(by, yy);
				br = Math.max(br, xx + 1);
				bb = Math.max(bb, yy + 1);
				border ||= !xx || !yy || xx === w - 1 || yy === h - 1;
				color ||= pixels[at + 3] < 240 || Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) - lo > 30;
			}
			if (border || color || ink < 4) continue;
			const tight = {
				x: (x + bx) / sx,
				y: (y + by) / sy,
				width: (br - bx) / sx,
				height: (bb - by) / sy
			};
			if (all.some((z) => z !== word && intersects(tight, z.rect))) continue;
			const expanded = dil(mask, w, h), scores = [];
			let complete = true;
			canvas.width = w;
			canvas.height = h;
			for (const text of choices[word.text]) {
				let best = null;
				for (const size of [
					nominal,
					nominal - .5,
					nominal + .5
				]) {
					measure.font = `${item.bold ? "bold " : ""}1000px "${item.font}"`;
					measure.fontKerning = "none";
					const m = measure.measureText(text), iw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, ih = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
					const scale = Math.round(tight.width * 1e5 / (iw * size));
					if (!(iw > 0 && ih > 0 && scale >= 85 && scale <= 115) || Math.abs(ih * size / 1e3 - tight.height) > .6) continue;
					for (const offset of [
						0,
						-.25,
						.25
					]) {
						if (probes >= 4096 || !spend(w * h * 3)) {
							complete = false;
							continue;
						}
						probes++;
						ctx.setTransform(1, 0, 0, 1, 0, 0);
						ctx.fillStyle = "#fff";
						ctx.fillRect(0, 0, w, h);
						ctx.font = `${item.bold ? "bold " : ""}${size * sy}px "${item.font}"`;
						ctx.fontKerning = "none";
						ctx.letterSpacing = "0px";
						ctx.fillStyle = "black";
						ctx.textBaseline = "alphabetic";
						const ox = tight.x + m.actualBoundingBoxLeft * size * scale / 1e5;
						ctx.setTransform(scale * sx / sy / 100, 0, 0, 1, ox * sx - x, (baseline + offset) * sy - y);
						ctx.fillText(text, 0, 0);
						const rgba = ctx.getImageData(0, 0, w, h).data, paint = new Uint8Array(w * h);
						let got = 0, common = 0, near = 0, px = w, py = h, pr = 0, pb = 0, clipped = false;
						for (let i = 0; i < paint.length; i++) if (Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) < 180) {
							paint[i] = 1;
							got++;
							common += mask[i];
							near += expanded[i];
							const xx = i % w, yy = Math.floor(i / w);
							px = Math.min(px, xx);
							py = Math.min(py, yy);
							pr = Math.max(pr, xx + 1);
							pb = Math.max(pb, yy + 1);
							clipped ||= !xx || !yy || xx === w - 1 || yy === h - 1;
						}
						if (!got || clipped) continue;
						const dp = dil(paint, w, h);
						let recall = 0;
						for (let i = 0; i < mask.length; i++) recall += mask[i] & dp[i];
						const raw = 2 * common / (ink + got), p = near / got, q = recall / ink, f1 = 2 * p * q / Math.max(1e-9, p + q), edge = Math.max(Math.abs(px - bx) / sx, Math.abs(py - by) / sy, Math.abs(pr - br) / sx, Math.abs(pb - bb) / sy);
						const score = raw - .05 * Math.abs(size - nominal) / nominal - .01 * Math.abs(offset);
						const value = {
							text,
							raw,
							f1,
							edge,
							size,
							scale,
							offset,
							score
						};
						if (!best || score > best.score) best = value;
					}
				}
				if (best) scores.push(best);
			}
			scores.sort((a, b) => b.score - a.score);
			const first = scores[0], original = scores.find((s) => s.text === word.text), second = scores[1];
			if (!complete || !first || first.text === word.text || first.raw < .8 || first.f1 < .99 || first.edge > .5 || first.score - (original?.score ?? 0) < .1 || first.score - (second?.score ?? 0) < .08) continue;
			const before = wordPlan(item, word, word);
			if (!before) continue;
			const padPx = Math.ceil(Math.max(sx, sy) * 2), pw = w + padPx * 2, ph = h + padPx * 2, target = new Uint8Array(pw * ph);
			for (let yy = 0; yy < h; yy++) target.set(mask.subarray(yy * w, (yy + 1) * w), (yy + padPx) * pw + padPx);
			const dt = dil(target, pw, ph);
			let winner = null;
			for (const size of [
				first.size,
				first.size - .5,
				first.size + .5
			]) for (const scale of [
				first.scale,
				first.scale - 1,
				first.scale + 1
			]) for (const dy of [
				0,
				-.25,
				.25
			]) {
				if (winner || size < 5 || size > 40 || Math.abs(size - nominal) > .5 || scale < 85 || scale > 115) continue;
				const proposed = {
					...word,
					text: first.text,
					font: item.font,
					fontFamily: item.font,
					bold: !!item.bold,
					size,
					glyphScale: scale,
					rect: {
						...tight,
						y: tight.y + dy
					},
					advanceWidth: tight.width,
					baselineX: tight.x
				};
				delete proposed.ocrGlyphScore;
				const after = wordPlan(item, word, proposed);
				if (!sameOtherSourceRuns(before, after)) continue;
				if (!spend(pw * ph * 3)) continue;
				canvas.width = pw;
				canvas.height = ph;
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.fillStyle = "#fff";
				ctx.fillRect(0, 0, pw, ph);
				ctx.setTransform(sx, 0, 0, sy, -x + padPx, -y + padPx);
				paintSourceWordRun(ctx, after.run);
				const rgba = ctx.getImageData(0, 0, pw, ph).data, actual = new Uint8Array(pw * ph);
				let got = 0, common = 0, px = pw, py = ph, pr = 0, pb = 0, clipped = false;
				for (let i = 0; i < actual.length; i++) if (Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) < 180) {
					actual[i] = 1;
					got++;
					common += target[i];
					const xx = i % pw, yy = Math.floor(i / pw);
					px = Math.min(px, xx);
					py = Math.min(py, yy);
					pr = Math.max(pr, xx + 1);
					pb = Math.max(pb, yy + 1);
					clipped ||= !xx || !yy || xx === pw - 1 || yy === ph - 1;
				}
				if (!got || clipped) continue;
				const da = dil(actual, pw, ph);
				let near = 0, recall = 0;
				for (let i = 0; i < actual.length; i++) {
					near += actual[i] & dt[i];
					recall += target[i] & da[i];
				}
				const precision = near / got, recalled = recall / ink, actualF1 = 2 * precision * recalled / Math.max(1e-9, precision + recalled), raw = 2 * common / (ink + got), edge = Math.max(Math.abs(px - padPx - bx) / sx, Math.abs(py - padPx - by) / sy, Math.abs(pr - padPx - br) / sx, Math.abs(pb - padPx - bb) / sy);
				if (raw >= .8 && actualF1 >= .99 && edge <= .5) winner = {
					replacement: proposed,
					plan: after,
					raw,
					actualF1,
					edge
				};
			}
			if (!winner) continue;
			originalPlan ??= before;
			const { replacement, raw, actualF1, edge } = winner;
			records.push({
				item,
				word,
				index,
				replacement,
				runIndex: winner.plan.index,
				expectedRun: winner.plan.run,
				proof: {
					word: index,
					original: word.text,
					text: first.text,
					rule: "source-ink-latin-confusion",
					rawF1: raw,
					f1At1px: actualF1,
					edgePt: edge,
					templateMargin: first.score - (second?.score ?? 0),
					originalMargin: first.score - (original?.score ?? 0),
					font: item.font,
					bold: !!item.bold,
					nominalSize: nominal,
					sourceRect: tight
				}
			});
		}
		const changes = /* @__PURE__ */ new Map();
		for (const row of records) {
			if (!changes.has(row.item)) changes.set(row.item, /* @__PURE__ */ new Map());
			changes.get(row.item).set(row.index, row);
		}
		const revised = /* @__PURE__ */ new Map();
		for (const [item, edits] of changes) {
			const words = item.words.map((word, i) => edits.get(i)?.replacement || word);
			let at = 0;
			const text = [...item.text].map((c) => !c.trim() ? c : words[at++].text).join("");
			if (at !== words.length) throw Error("Invalid OCR word mapping");
			revised.set(item.id, {
				...item,
				text,
				words,
				ocrOriginalText: item.ocrOriginalText ?? item.text,
				ocrCorrections: [...item.ocrCorrections || [], ...[...edits.values()].map((row) => row.proof)]
			});
		}
		const update = (x) => {
			if (!x || typeof x !== "object") return x;
			if (Array.isArray(x)) return x.map(update);
			if (x.type === "text" && revised.has(x.id)) return revised.get(x.id);
			return x;
		};
		const next = {
			...scene,
			items: scene.items.map(update),
			sources: scene.sources.map((source) => revised.has(source.id) ? {
				...source,
				text: revised.get(source.id).text
			} : source)
		};
		if (records.length) {
			// Separately safe edits can still interact when Word regroups a line.
			// Check their combined writer plan before publishing any spelling.
			const first = records[0], item = revised.get(first.item.id), word = item.words[first.index];
			const combined = wordPlan(item, word, word, next);
			const expected = new Map(records.map(row => [row.runIndex, row.expectedRun]));
			if (!combined || expected.size !== records.length || combined.runs.length !== originalPlan.runs.length
				|| !combined.runs.every((run, index) => {
					const prior = expected.get(index) || originalPlan.runs[index];
					return run.item.text === prior.item.text && Math.abs(run.x - prior.x) <= .025 + 1e-8
						&& run.baseline === prior.baseline && run.position === prior.position && run.spacing === prior.spacing
						&& JSON.stringify(run.options) === JSON.stringify(prior.options);
				})) return prepared;
		}
		check();
		return records.length ? {
			...prepared,
			scene: next
		} : prepared;
	} finally {
		if (canvas) canvas.width = canvas.height = 0;
		if (metricCanvas) metricCanvas.width = metricCanvas.height = 0;
	}
}
export { refineOcrLatinCharacters };
