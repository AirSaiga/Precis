import yaml
import datetime

with open('backend/.precis/data_sources.yaml', 'r') as f:
    data = yaml.safe_load(f)

for ds in data.get('data_sources', []):
    # 修复双斜杠为单斜杠
    for key in ['fileId', 'localPath', 'folderPath']:
        if ds.get(key):
            ds[key] = ds[key].replace('//', '/')
    # 确保 folderPath 是相对路径（去掉盘符前缀）
    fp = ds.get('folderPath', '')
    if fp and len(fp) > 2 and fp[1] == ':':
        # 绝对路径，尝试提取相对部分
        # 如果路径格式是 d:/.../qa_v3_complex/data，提取 data
        parts = fp.split('/')
        if 'data' in parts:
            idx = parts.index('data')
            ds['folderPath'] = '/'.join(parts[idx:])
        else:
            ds['folderPath'] = ''

data['last_updated'] = datetime.datetime.now().isoformat()
with open('backend/.precis/data_sources.yaml', 'w') as f:
    yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

print('Fixed paths in backend/.precis/data_sources.yaml')
for ds in data.get('data_sources', []):
    print('  fileId:', ds.get('fileId'))
    print('  localPath:', ds.get('localPath'))
    print('  folderPath:', ds.get('folderPath'))
