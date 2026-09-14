import os, struct, math, shutil

src='/mnt/data/v16_unpack/Manu-Stream-Radio-V1.6-Windows/Manu-Stream-Radio-V1.6.exe'
outdir='/mnt/data/Manu-Stream-Radio-V1.7-Windows'
os.makedirs(outdir, exist_ok=True)
out=os.path.join(outdir,'Manu-Stream-Radio-V1.7.exe')

assets=[
    ('style','/mnt/data/style_v17.css',0x3ffde8),
    ('index','/mnt/data/index_v17.html',0x3ffd88),
    ('app','/mnt/data/app_v17.js',0x3ffd58),
]

def align(v,a): return (v+a-1)//a*a

with open(src,'rb') as f: data=bytearray(f.read())
# PE basics
pe=struct.unpack_from('<I',data,0x3c)[0]
assert data[pe:pe+4]==b'PE\0\0'
coff=pe+4
nsec=struct.unpack_from('<H',data,coff+2)[0]
opt_size=struct.unpack_from('<H',data,coff+16)[0]
opt=coff+20
magic=struct.unpack_from('<H',data,opt)[0]
assert magic==0x20b
image_base=struct.unpack_from('<Q',data,opt+24)[0]
sec_align=struct.unpack_from('<I',data,opt+32)[0]
file_align=struct.unpack_from('<I',data,opt+36)[0]
size_headers=struct.unpack_from('<I',data,opt+60)[0]
section_table=opt+opt_size
assert nsec==8
new_header=section_table+nsec*40
assert new_header+40 <= size_headers

# append at end aligned; use next RVA based on current SizeOfImage
raw_ptr=align(len(data), file_align)
if raw_ptr>len(data): data += b'\0'*(raw_ptr-len(data))
new_rva=align(struct.unpack_from('<I',data,opt+56)[0], sec_align)

payload=bytearray()
asset_meta={}
for name,path,meta_off in assets:
    # align each asset to 16 bytes within section
    rel=align(len(payload),16)
    if rel>len(payload): payload += b'\0'*(rel-len(payload))
    b=open(path,'rb').read()
    payload += b
    asset_meta[name]=(rel,len(b),meta_off,b)

virt_size=len(payload)
raw_size=align(virt_size,file_align)
data += payload
if raw_size>virt_size: data += b'\0'*(raw_size-virt_size)

# add section header
name=b'.msr17\0\0'
characteristics=0x40000040 # initialized data + readable
hdr=struct.pack('<8sIIIIIIHHI', name, virt_size, new_rva, raw_size, raw_ptr, 0,0,0,0,characteristics)
data[new_header:new_header+40]=hdr
struct.pack_into('<H',data,coff+2,nsec+1)
new_size_image=align(new_rva+virt_size,sec_align)
struct.pack_into('<I',data,opt+56,new_size_image)

# patch Go embed pointer/len metadata
for name,(rel,l,meta_off,b) in asset_meta.items():
    va=image_base+new_rva+rel
    struct.pack_into('<Q',data,meta_off,va)
    struct.pack_into('<Q',data,meta_off+8,l)

with open(out,'wb') as f: f.write(data)
print('built',out, len(data))
print('PE',hex(pe),'image_base',hex(image_base),'sec_align',hex(sec_align),'file_align',hex(file_align))
print('new section RVA',hex(new_rva),'raw',hex(raw_ptr),'virt',hex(virt_size),'raw_size',hex(raw_size),'size_image',hex(new_size_image))
for name,(rel,l,meta_off,b) in asset_meta.items():
    print(name,'rel',hex(rel),'len',l,'VA',hex(image_base+new_rva+rel),'meta',hex(meta_off))
