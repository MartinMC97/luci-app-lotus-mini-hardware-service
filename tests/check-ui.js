const fs = require('fs'), vm = require('vm'), assert = require('assert');
const code = fs.readFileSync('root/www/luci-static/resources/view/status/lotus_hardware.js', 'utf8');
assert(!/innerHTML|style:|WebSocket|\/sys\//.test(code));
function node(tag, attrs, children) { return { tag, attrs: attrs || {}, children: children || [], value: '',
    replaceChildren(...items) { this.children = items; }, appendChild(item) { this.children.push(item); } }; }
async function test(readonly) {
    const calls = [], messages = [];
    const status = { ok: true, result: { running: true, autostart: true,
        state: { microphone_muted: true, owner_connection: 8, volume_percent: 0,
            battery: { available: true, percent: 0, external_power_connected: null },
            temperature: { readings: [{ type: 'soc-thermal', available: true, millidegrees_celsius: 45000 }] } },
        capabilities: { volume: { available: true }, privacy: { available: true } } } };
    const ctx = { _: s => s, E: node, L: { hasViewPermission: () => !readonly, url: p => '/' + p },
        view: { extend: x => x }, poll: { add() {} }, ui: { addNotification: (...a) => messages.push(a),
            showModal() {}, hideModal() {} }, rpc: { declare: spec => async (...args) => {
                calls.push({ method: spec.method, args }); return spec.method === 'status' ? status : { ok: true, result: {} };
            } } };
    const page = vm.runInNewContext('(function(){' + code + '\n})()', ctx);
    await page.render(await page.load());
    assert(calls.every(c => c.method === 'status'), 'render must not control anything');
    const buttons = page.buttons;
    buttons.forEach(b => assert.equal(b.node.disabled,
        readonly || ['led', 'stop', 'start', 'enable'].includes(b.kind), 'owner/mute/service/readonly gate'));
    assert.equal(page.volume.attrs.type, 'range');
    assert.equal(page.volume.value, '0');
    page.volume.value = '25'; page.volume.attrs.input();
    page.update(status);
    assert.equal(page.volume.value, '25', 'poll must not reset active drag');
    assert.equal(calls.some(c => c.method === 'set_volume'), false, 'drag preview must not flood RPC');
    await page.volume.attrs.change();
    assert.equal(calls.some(c => c.method === 'set_volume' && c.args[0] === 25), !readonly);
    const text = JSON.stringify(page.table);
    assert(text.includes('0%') && text.includes('45.0') && text.includes('未知'), '0 and unknown are distinct');
    assert(!/隐私保存|音量保存|业务连接|后端|录放音占用登记|soc-thermal/.test(text));
    page.update({ ok: true, result: { ...status.result, state: { ...status.result.state,
        volume_persistence: { error: 'disk_error' }, privacy_persistence: { error: 'write_error' } } } });
    assert(JSON.stringify(page.table).includes('保存失败'));
    assert(!JSON.stringify(page.table).includes('disk_error'));
    page.update(status);
    assert(!JSON.stringify(page.table).includes('保存失败'));
    page.update({ ok: false, error: 'invalid_request' });
    assert(JSON.stringify(page.table).includes('请求格式有误'));
    assert(!JSON.stringify(page.table).includes('未运行'));
    page.update(status);
    calls.length = 0;
    await buttons.find(b => b.kind === 'volume').node.attrs.click();
    assert.equal(calls.some(c => c.method === 'adjust_volume'), !readonly);
    page.update({ ok: true, result: { running: false } });
    assert(!JSON.stringify(page.table).includes('45.0'), 'unavailable must clear stale readings');
    assert(buttons.filter(b => !['start', 'enable', 'disable'].includes(b.kind)).every(b => b.node.disabled));
    assert.equal(buttons.find(b => b.kind === 'start').node.disabled, readonly);
    page.update({ ok: true, result: { running: true, autostart: false, state: {}, capabilities: {} } });
    assert.equal(buttons.find(b => b.kind === 'enable').node.disabled, readonly);
    assert.equal(buttons.find(b => b.kind === 'disable').node.disabled, true);
    assert.equal(page.handleSave, null);
}
(async () => {
    await test(false); await test(true);
    const menu = JSON.parse(fs.readFileSync('root/usr/share/luci/menu.d/luci-app-lotus-mini-hardware-service.json'));
    assert.deepEqual(Object.keys(menu), ['admin/status/lotus_hardware']);
    assert(!/独立本机接口|协作约定|后台合并保存|旧硬件控制者|硬件服务配置/.test(code));
    const terms = [...code.matchAll(/_\('([^']*)'\)/g)].map(match => match[1]);
    const catalog = fs.readFileSync('po/zh_Hans/lotus-mini-hardware-service.po', 'utf8');
    const template = fs.readFileSync('po/templates/lotus-mini-hardware-service.pot', 'utf8');
    terms.forEach(term => {
        assert(catalog.includes('msgid ' + JSON.stringify(term)), 'missing Chinese entry: ' + term);
        assert(template.includes('msgid ' + JSON.stringify(term)), 'missing translation template: ' + term);
    });
    console.log('UI permissions, slider, service state, user wording, warnings and single-page navigation passed');
})()
    .catch(e => { console.error(e); process.exitCode = 1; });
