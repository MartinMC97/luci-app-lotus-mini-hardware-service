"""Opt-in real HTTP test; SSH creates a short-lived read-only session.

Usage: python3 tests/test_http_device.py --host DEVICE_HOST --key KEY --known-hosts FILE
Only queries status/logs, never changes hardware. Session IDs are not printed.
"""
import argparse
import json
import subprocess
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', required=True)
parser.add_argument('--key', required=True)
parser.add_argument('--known-hosts', required=True)
args = parser.parse_args()
ssh = ['ssh', '-i', args.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
       '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + args.known_hosts,
       'root@' + args.host]

def ubus(method, params):
    # JSON is sent on stdin, not interpolated into the remote command.
    result = subprocess.run(ssh + ['IFS= read -r payload; ubus call session ' + method + ' "$payload"'],
        input=json.dumps(params) + '\n', text=True, capture_output=True, timeout=10, check=True)
    return json.loads(result.stdout) if result.stdout.strip() else {}

session = ubus('create', {'timeout': 60})['ubus_rpc_session']
try:
    ubus('grant', {'ubus_rpc_session': session, 'scope': 'ubus',
                  'objects': [['lotus_hardware', 'status'], ['lotus_hardware', 'logs']]})
    for method in ('status', 'logs', 'set_volume'):
        body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'call',
            'params': [session, 'lotus_hardware', method,
                       {'percent': 70} if method == 'set_volume' else {}]}).encode()
        request = urllib.request.Request('http://' + args.host + '/ubus', data=body,
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            reply = json.load(response)
        result = reply.get('result', [])
        if method == 'set_volume':
            # uhttpd maps ubus permission denial to JSON-RPC -32002;
            # some transports instead return the native ubus status 6.
            denied = (result and result[0] == 6) or reply.get('error', {}).get('code') == -32002
            assert denied, 'read-only session must deny control: ' + repr(reply)
            print('PASS: HTTP read-only ACL rejects volume control')
        else:
            assert len(result) == 2 and result[0] == 0 and result[1].get('ok'), \
                method + ': HTTP backend rejected query'
            if method == 'status':
                assert result[1]['result']['running'] is True
            print('PASS: authenticated HTTP ' + method)
finally:
    ubus('destroy', {'ubus_rpc_session': session})
