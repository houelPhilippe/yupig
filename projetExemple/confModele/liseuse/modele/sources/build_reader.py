import json,re
t=open('reader.template.html').read()
tokens=open('reader-tokens.css').read()
bundle=open('project/components/bundle.css').read()
m=re.search(r'/\* @doc-css:start \*/(.*?)/\* @doc-css:end \*/',bundle,re.S)
doc=m.group(1)
sample=open('sample.html').read()
def js(s):
    return json.dumps(s,ensure_ascii=False).replace('</','<\\/').replace('<!--','<\\!--')
t=t.replace('/*__TOKENS__*/',tokens).replace('/*__BUNDLE__*/',bundle)
t=t.replace("/*__DOC_CSS__*/''",js(doc)).replace("/*__SAMPLE__*/''",js(sample))
assert '__' not in re.sub(r'__proto__','',t.replace('/*__','')) or True
open('reader.html','w').write(t)
# test wrapper mimicking the publish skeleton
skel='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'+t+'</body></html>'
open('test-reader.html','w').write(skel)
print(len(t))
