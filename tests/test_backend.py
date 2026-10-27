import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
CORE = Path(os.environ.get('HARDWARE_SERVICE_REPO', str(ROOT.parent / 'lotus-mini-hardware-service')))

class Backend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / 'build').mkdir(exist_ok=True)
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-O2',
            '-DHARDWARE_UI_TESTING', '-isystem', str(CORE / 'src'), '-isystem', str(CORE / 'third_party/picojson'),
            str(ROOT / 'src/backend.cpp'), '-pthread', '-o', str(ROOT / 'build/backend')], check=True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lotus-hardware-ui-')
        self.socket = Path(self.temp.name) / 'control.sock'
        self.log = tempfile.TemporaryFile()
        self.process = subprocess.Popen([str(CORE / 'build/lotus-hardwared'), '--mock',
            '--socket', str(self.socket)], stderr=self.log)
        for _ in range(100):
            if self.socket.exists(): break
            time.sleep(.01)
        self.env = dict(os.environ, HARDWARE_UI_TEST_SOCKET=str(self.socket))

    def tearDown(self):
        if self.process.poll() is None: self.process.terminate()
        self.process.wait(timeout=3)
        self.log.close()
        self.temp.cleanup()

    def call(self, method, body='{}'):
        result = subprocess.run([str(ROOT / 'build/backend'), 'call', method], input=body,
            text=True, capture_output=True, env=self.env, timeout=7, check=True)
        return json.loads(result.stdout)

    def test_status_is_readonly(self):
        before = self.call('status')
        self.assertTrue(before['result']['running'])
        self.assertEqual(before['result']['state']['owner_connection'], 0)
        self.assertTrue(before['result']['state']['microphone_muted'])
        self.assertEqual(self.call('status')['result']['state'], before['result']['state'])

    def test_http_session_metadata(self):
        session = '0123456789abcdef0123456789abcdef'
        self.assertTrue(self.call('status', json.dumps({'ubus_rpc_session': session}))['ok'])
        self.assertEqual(self.call('set_volume', json.dumps({'percent': 25,
            'ubus_rpc_session': session}))['result']['percent'], 25)
        for bad in (None, False, {}, 'short', 'x' * 32):
            self.assertFalse(self.call('status', json.dumps({'ubus_rpc_session': bad}))['ok'])
        self.assertFalse(self.call('status', json.dumps({'ubus_rpc_session': session,
            'unknown': True}))['ok'])

    def test_volume_and_validation(self):
        self.assertEqual(self.call('set_volume', '{"percent":0}')['result']['percent'], 0)
        self.assertEqual(self.call('adjust_volume', '{"delta":5}')['result']['percent'], 5)
        for body in ('{"percent":101}', '{"percent":true}', '{"percent":1.5}',
                     '{"percent":30,"path":"/dev/mem"}', '{"percent":2,"percent":3}'):
            self.assertFalse(self.call('set_volume', body)['ok'])
        self.assertFalse(self.call('adjust_volume', '{"delta":100}')['ok'])

    def test_privacy(self):
        self.assertFalse(self.call('set_privacy', '{"muted":"false"}')['ok'])
        self.assertTrue(self.call('set_privacy', '{"muted":false}')['ok'])
        self.assertFalse(self.call('status')['result']['state']['microphone_muted'])
        self.assertTrue(self.call('set_privacy', '{"muted":true}')['ok'])

    def test_bounds_and_fixed_actions(self):
        for method, body in [('status', '{"other":true}'), ('service', '{"action":"reboot"}'),
            ('service', '{"action":"start; reboot"}'), ('test_led', '{"effect":"unknown"}'),
            ('status', '['*30 + '0' + ']'*30), ('status', ' '*17000)]:
            self.assertFalse(self.call(method, body)['ok'])

    def test_service_unavailable(self):
        self.process.terminate(); self.process.wait(timeout=3)
        status = self.call('status')['result']
        self.assertFalse(status['running'])
        self.assertNotIn('state', status)
        self.assertFalse(self.call('set_volume', '{"percent":40}')['ok'])

    def test_busy_protection_and_led_cleanup(self):
        self.call('set_privacy', '{"muted":false}')
        effect = subprocess.Popen([str(ROOT / 'build/backend'), 'call', 'test_led'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=self.env)
        try:
            effect.stdin.write('{"effect":"gradient"}'); effect.stdin.close()
            for _ in range(100):
                if self.call('status')['result']['state']['owner_connection']: break
                time.sleep(.01)
            for action in ('stop', 'restart'):
                result = self.call('service', json.dumps({'action': action}))
                self.assertEqual(result['error'], 'resource_busy_stop_application_first')
            self.assertFalse(self.call('test_led', '{"effect":"solid"}')['ok'])
            self.assertTrue(json.loads(effect.stdout.read())['ok'])
            effect.wait(timeout=3)
            time.sleep(.1)
            state = self.call('status')['result']['state']
            self.assertEqual(state['owner_connection'], 0)
            self.assertEqual(state['led']['effect'], 'off')
        finally:
            if effect.poll() is None: effect.kill(); effect.wait(timeout=3)
            effect.stdout.close()

if __name__ == '__main__': unittest.main(verbosity=2)
