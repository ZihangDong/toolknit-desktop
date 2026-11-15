"""Reproducible PP-OCRv5 runtime preparation; engineering only, never shipped.

Export original pinned Paddle inference.json/parameters with Paddle 3.1.1 and
paddle2onnx 2.1.0, opset 17, then pass their directory and the original rec
config.json here. No quantization or training is applied. Unused initializers
are removed only after numerical equivalence is checked with ORT 1.22.1.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort

p = argparse.ArgumentParser()
p.add_argument('--models', type=Path, required=True)
p.add_argument('--config', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
opts = ort.SessionOptions(); opts.intra_op_num_threads = 2; opts.inter_op_num_threads = 1
manifest = []
for name in ['det', 'rec']:
    source = args.models / (name + '.onnx')
    model = onnx.load(source)
    before = ort.InferenceSession(str(source), sess_options=opts, providers=['CPUExecutionProvider'])
    used = {v for node in model.graph.node for v in node.input}
    used.update(v.name for v in model.graph.input)
    used.update(v.name for v in model.graph.output)
    retained = [v for v in model.graph.initializer if v.name in used]
    removed = len(model.graph.initializer) - len(retained)
    del model.graph.initializer[:]; model.graph.initializer.extend(retained)
    onnx.checker.check_model(model)
    target = args.output / source.name; onnx.save(model, target)
    after = ort.InferenceSession(str(target), sess_options=opts, providers=['CPUExecutionProvider'])
    shape = (1,3,96,128) if name == 'det' else (1,3,48,320)
    data = np.random.default_rng(1106).normal(size=shape).astype(np.float32)
    np.testing.assert_array_equal(before.run(None,{before.get_inputs()[0].name:data})[0], after.run(None,{after.get_inputs()[0].name:data})[0])
    manifest.append({'name':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'removedUnusedInitializers':removed})
chars = json.loads(args.config.read_text(encoding='utf-8'))['PostProcess']['character_dict']
target = args.output / 'dictionary.json'
target.write_text(json.dumps(['']+chars+[' '],ensure_ascii=False,separators=(',',':')),encoding='utf-8',newline='\n')
manifest.append({'name':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
metadata = {'version':'pp-ocrv5-mobile-onnx-20261106-r1','license':'Apache-2.0','derived':True,'changes':'Paddle to ONNX opset17; removed unused initializers; blank/space CTC dictionary mapping. No retraining.','upstream':{'det':'0d63e78e2b680928f6b1747d76a08db6e645efb7','rec':'682f20538d8c086cb2128e5cfac775e6c4904e85'},'tools':{'paddlepaddle':'3.1.1','paddle2onnx':'2.1.0','onnx':'1.17.0','onnxruntime':'1.22.1'},'files':manifest}
(args.output/'manifest-onnx-20261106-r1.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps(metadata))
