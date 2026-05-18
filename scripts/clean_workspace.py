import yaml
import re
import datetime

with open('backend/.precis/data_sources.yaml', 'r') as f:
    data = yaml.safe_load(f)

cleaned = []
removed = 0
for ds in data.get('data_sources', []):
    fileId = ds.get('fileId', '')
    drives = re.findall(r'[a-zA-Z]:', fileId)
    if len(drives) >= 2:
        print('Removing malformed:', ds.get('id'), fileId[:80])
        removed += 1
        continue
    if '//' in fileId and not fileId.startswith('http') and re.search(r'//[a-zA-Z]:', fileId):
        print('Removing malformed:', ds.get('id'), fileId[:80])
        removed += 1
        continue
    cleaned.append(ds)

print(f'Cleaned: {len(cleaned)} / {len(cleaned) + removed}')

if removed > 0:
    data['data_sources'] = cleaned
    data['last_updated'] = datetime.datetime.now().isoformat()
    with open('backend/.precis/data_sources.yaml', 'w') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
    print('File updated.')
else:
    print('No malformed entries found.')
