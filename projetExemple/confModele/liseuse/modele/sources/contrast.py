import json,sys
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c:c/12.92 if c<=.03928 else ((c+.055)/1.055)**2.4
    return .2126*f(r)+.7152*f(g)+.0722*f(b)
def cr(a,b):
    la,lb=lum(a),lum(b); 
    if la<lb: la,lb=lb,la
    return (la+.05)/(lb+.05)
T={
 'light':dict(chrome='#eef1f2',page='#fbfcfc',raised='#ffffff',ink='#1b2528',ink_muted='#4a5a5f',rule='#d5dcde',rule_strong='#77878c',accent='#0b6466',on_accent='#ffffff',accent_ink='#0b6466',accent_soft='#d5eaea',mark='#ffe6a3',mark_active='#ffb43b',on_mark='#1b2528',code_bg='#eef1f2',focus='#0b6466'),
 'sepia':dict(chrome='#e5dbc6',page='#f4ecd9',raised='#faf5e8',ink='#3a3023',ink_muted='#61553f',rule='#d2c5a8',rule_strong='#84714f',accent='#1d5b4d',on_accent='#fbf6e9',accent_ink='#1d5b4d',accent_soft='#d8e0c8',mark='#f1d27a',mark_active='#e9a93a',on_mark='#2c2418',code_bg='#ebe1cb',focus='#1d5b4d'),
 'dark':dict(chrome='#12181a',page='#182022',raised='#212b2e',ink='#dde5e7',ink_muted='#9fafb4',rule='#2e3a3e',rule_strong='#6a7c82',accent='#5cc2bd',on_accent='#08191a',accent_ink='#6fd0ca',accent_soft='#1d3a3b',mark='#d9b64a',mark_active='#ffcf5c',on_mark='#151a1c',code_bg='#1f2a2d',focus='#6fd0ca'),
}
bad=0
for th,t in T.items():
    grounds=['chrome','page','raised','code_bg']
    checks=[]
    for g in grounds:
        checks+= [('ink',g,4.5),('ink_muted',g,4.5),('accent_ink',g,4.5),('rule_strong',g,3),('focus',g,3)]
    checks+=[('on_accent','accent',4.5),('ink','accent_soft',4.5),('accent_ink','accent_soft',4.5),('on_mark','mark',4.5),('on_mark','mark_active',4.5),('ink_muted','accent_soft',4.5),('accent','accent_soft',3),('focus','accent_soft',3)]
    for a,b,m in checks:
        r=cr(t[a],t[b]); 
        if r<m: bad+=1; print(f'FAIL {th}: {a} {t[a]} on {b} {t[b]} = {r:.2f} < {m}')
    print(th,'ok' if not bad else '')
print('bad',bad)
json.dump({k:{a.replace('_','-'):b for a,b in v.items()} for k,v in T.items()},open('palette.json','w'),indent=1)
