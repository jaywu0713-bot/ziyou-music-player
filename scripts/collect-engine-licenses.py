"""Keep third-party notices with every reproducible engine build."""
import importlib.metadata
from pathlib import Path
import shutil
import sys

output=Path(sys.argv[1]); output.mkdir(parents=True, exist_ok=True)
for distribution in importlib.metadata.distributions():
    for file in distribution.files or []:
        if any(name in file.name.upper() for name in ('LICENSE', 'LICENCE', 'COPYING', 'COPYRIGHT', 'NOTICE')):
            source=Path(distribution.locate_file(file))
            if source.is_file():
                target=output/distribution.metadata['Name']/str(file).replace('../','')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source,target)
python_license=Path(sys.base_prefix)/'Resources'/'English.lproj'/'License.rtf'
if python_license.is_file():
    shutil.copyfile(python_license,output/'Python-License.rtf')
