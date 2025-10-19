import csv, json, sys
p = r"c:\Users\OGS\Desktop\!THECODE!\DnDex\DnDOrganizer\VARIANTE - Moves.csv"
rows = []
with open(p, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    for r in reader:
        rows.append(r)
if not rows:
    print('No rows')
    sys.exit(0)
headers = [h.strip() for h in rows[0]]
# helper
def find_idx(aliases):
    a = [x.lower() for x in aliases]
    for i,h in enumerate(headers):
        hh = (h or '').lower()
        if hh in a: return i
        for al in a:
            if al and al in hh: return i
    return -1

idx_name = find_idx(['name','nombre','titulo','title'])
idx_desc = find_idx(['description','descripción','descripcion','desc'])
idx_tags = find_idx(['tags','etiquetas','tag'])
idx_img = find_idx(['img','image','imagen'])

moves = []
for r in rows[1:]:
    # pad
    while len(r) < len(headers): r.append('')
    name = r[idx_name].strip() if idx_name>=0 else ''
    desc = r[idx_desc].strip() if idx_desc>=0 else ''
    tags = [t.strip() for t in (r[idx_tags] if idx_tags>=0 else '').split(',') if t.strip()]
    img = r[idx_img].strip() if idx_img>=0 else ''
    if name:
        moves.append({'name': name, 'description': desc, 'tags': tags, 'img': img})

print('rows_total:', len(rows))
print('moves_found:', len(moves))
print(json.dumps(moves[:10], ensure_ascii=False, indent=2))
