import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class Menu(unittest.TestCase):
    def test_install_restore_and_unknown_edits(self):
        with tempfile.TemporaryDirectory(prefix='lotus-ui-menu-') as directory:
            folder = Path(directory)
            stock = ROOT / 'root/usr/share/lotus-hardware-ui/legacy-menu.json'
            guard = ROOT / 'root/usr/share/lotus-hardware-ui/guarded-menu.json'
            menu = folder / 'menu.json'
            source = (ROOT / 'root/usr/libexec/lotus-hardware-ui-menu').read_text()
            source = source.replace('menu=/usr/share/luci/menu.d/lotus-sensors.json', f'menu={menu}')
            source = source.replace('stock=/usr/share/lotus-hardware-ui/legacy-menu.json', f'stock={stock}')
            source = source.replace('guard=/usr/share/lotus-hardware-ui/guarded-menu.json', f'guard={guard}')
            # Keep test logging within this host process, not the host syslog.
            source = source.replace('logger -t lotus-hardware-ui', 'echo')
            script = folder / 'test.sh'; script.write_text(source)
            def call(action): subprocess.run(['sh', str(script), action], check=True, capture_output=True)
            menu.write_bytes(stock.read_bytes())
            call('install'); self.assertEqual(menu.read_bytes(), guard.read_bytes())
            call('install'); self.assertEqual(menu.read_bytes(), guard.read_bytes())
            call('restore'); self.assertEqual(menu.read_bytes(), stock.read_bytes())
            menu.write_text('{"custom":true}\n'); call('install'); call('restore')
            self.assertEqual(menu.read_text(), '{"custom":true}\n')
            menu.unlink(); menu.symlink_to(stock); call('install')
            self.assertTrue(menu.is_symlink())

if __name__ == '__main__': unittest.main(verbosity=2)
