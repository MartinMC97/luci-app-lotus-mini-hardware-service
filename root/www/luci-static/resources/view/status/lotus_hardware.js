'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

const invoke = (method, params) => rpc.declare({ object: 'lotus_hardware', method: method,
    params: params || [], expect: { '': {} } });
const getStatus = invoke('status'), getLogs = invoke('logs');
const setVolume = invoke('set_volume', ['percent']), adjustVolume = invoke('adjust_volume', ['delta']);
const setPrivacy = invoke('set_privacy', ['muted']), service = invoke('service', ['action']);
const testLed = invoke('test_led', ['effect']);
const explainError = code => ({
    invalid_request: _('请求格式有误，请刷新页面后重试。'),
    service_unavailable: _('无法连接硬件服务，请检查服务是否运行。'),
    resource_busy_stop_application_first: _('有应用正在使用硬件，请先停止该应用。'),
    busy: _('有应用正在使用硬件，暂时无法执行此操作。'),
    startup_failed_check_configuration_and_log: _('服务启动失败，请查看下方日志。'),
    service_command_failed: _('服务操作失败，请查看下方日志。'),
    log_unavailable: _('暂时无法读取日志，请稍后重试。')
})[code] || _('操作未成功，请查看下方日志。');

return view.extend({
    load: function() { return getStatus(); },
    refresh: function() {
        return getStatus().then(reply => this.update(reply)).catch(error => {
            this.update({ ok: false, error: String(error) });
        });
    },
    act: function(fn) {
        if (!L.hasViewPermission() || this.busy) return Promise.resolve();
        this.busy = true; this.update(this.last);
        return Promise.resolve().then(fn).then(reply => {
            if (!reply.ok) throw new Error(explainError(reply.error));
        }).catch(error => ui.addNotification(null, E('p', {}, [String(error)]), 'error'))
          .finally(() => { this.busy = false; return this.refresh(); });
    },
    unmute: function() {
        if (!L.hasViewPermission()) return;
        ui.showModal(_('解除麦克风静音'), [
            E('p', {}, [_('解除后，正在运行的语音应用可能恢复唤醒和录音。是否继续？')]),
            E('div', { 'class': 'right' }, [
                E('button', { 'class': 'cbi-button', click: ui.hideModal }, [_('取消')]),
                E('button', { 'class': 'cbi-button cbi-button-action', click: () => {
                    ui.hideModal(); return this.act(() => setPrivacy(false));
                } }, [_('确认解除')])
            ])
        ]);
    },
    update: function(reply) {
        this.last = reply;
        const data = reply && reply.ok ? reply.result || {} : {};
        const running = data.running === true, state = running ? data.state || {} : {};
        const cap = data.capabilities || {}, battery = state.battery || {};
        const temperature = state.temperature || {}, audio = state.audio || {};
        const privacy = state.privacy_persistence || {}, persistence = state.volume_persistence || {};
        const yesno = v => v === true ? _('是') : v === false ? _('否') : _('未知');
        const percent = v => typeof v === 'number' && isFinite(v) ? String(v) + '%' : _('不可用');
        const owner = state.owner_connection || audio.owner_connection || 0;
        const rows = [
            [_('硬件服务'), running ? _('运行中') : reply && reply.ok && !data.error ? _('未运行') : _('无法获取状态')],
            [_('开机自动运行'), yesno(data.autostart)],
            [_('电池电量'), battery.available ? percent(battery.percent) + ' (' + _('五档读数') + ')' : _('不可用')],
            [_('已连接外接电源'), yesno(battery.external_power_connected)],
            [_('充电状态'), ({ Charging: _('充电中'), Discharging: _('使用电池'), Full: _('已充满'),
                'Not charging': _('未充电'), Unknown: _('未知') })[battery.status] || _('未知')],
            [_('音量'), percent(state.volume_percent)],
            [_('麦克风'), state.microphone_muted === true ? _('已静音') : state.microphone_muted === false ? _('未静音') : _('未知')],
            [_('指示灯'), running ? cap.led && cap.led.rgb ? _('可用') : _('不可用') : _('未知')],
            [_('按键'), running ? cap.buttons && cap.buttons.available ? _('可用') : _('不可用') : _('未知')],
            [_('当前灯效'), state.led ? (({ off: _('关闭'), solid: _('常亮'), breath: _('呼吸'),
                gradient: _('渐变') })[state.led.effect] || _('未知')) +
                (state.led.safety ? ' (' + _('麦克风静音指示') + ')' : '') : _('未知')],
            [_('应用使用状态'), running ? owner ? _('有应用正在使用硬件') : _('空闲') : _('未知')]
        ];
        (temperature.readings || []).forEach(sensor => rows.push([
            ({ 'soc-thermal': _('处理器温度'), 'gpu-thermal': _('图形模块温度') })[sensor.type] || _('芯片温度'), sensor.available && typeof sensor.millidegrees_celsius === 'number' ?
                (sensor.millidegrees_celsius / 1000).toFixed(1) + ' °C' : _('不可用')
        ]));
        if (reply && (!reply.ok || data.error)) rows.push([_('提示'), explainError(reply.error || data.error)]);
        if (temperature.error) rows.push([_('提示'), _('暂时无法读取温度。')]);
        if (privacy.pending) rows.push([_('麦克风操作'), _('正在保存静音设置，请稍候；解除静音前会保持静音。')]);
        if (privacy.error) rows.push([_('保存失败'), _('麦克风静音设置未能保存，请重试。当前状态见上方。')]);
        if (persistence.error || persistence.status === 'error') rows.push([_('保存失败'),
            _('音量未能保存，重启后可能恢复为旧音量。')]);
        this.table.replaceChildren(...rows.map(row => E('tr', { 'class': 'tr' }, [
            E('td', { 'class': 'td left' }, [String(row[0])]), E('td', { 'class': 'td left' }, [String(row[1])])
        ])));
        this.buttons.forEach(item => {
            item.node.disabled = !L.hasViewPermission() || this.busy ||
                (!['start', 'enable', 'disable'].includes(item.kind) && !running) ||
                (item.kind === 'start' && running) ||
                (item.kind === 'enable' && data.autostart === true) ||
                (item.kind === 'disable' && data.autostart === false) ||
                ((item.kind === 'led' || item.kind === 'stop') && !!owner) ||
                (item.kind === 'led' && state.microphone_muted !== false) ||
                (item.kind === 'volume' && !(cap.volume && cap.volume.available)) ||
                (item.kind === 'privacy' && !(cap.privacy && cap.privacy.available));
        });
        this.serviceHint.textContent = !reply || !reply.ok || data.error ? _('暂时无法获取服务状态，请检查网络连接后刷新页面。') : !running ? _('启动服务后才能调整音量、麦克风和指示灯。') : owner ?
            _('有应用正在使用硬件。若要停止或重启服务、测试灯效，请先在该应用的页面停止它。') :
            state.microphone_muted === true ? _('麦克风已静音，灯效测试暂不可用，以保留静音指示。') :
            _('灯效测试持续约两秒，不播放声音。');
        this.volume.disabled = !L.hasViewPermission() || !running || this.busy || !(cap.volume && cap.volume.available);
        if (!this.volumeEditing) {
            this.volume.value = typeof state.volume_percent === 'number' ? String(state.volume_percent) : '0';
            this.volumeLabel.textContent = percent(state.volume_percent);
        }
    },
    render: function(reply) {
        this.buttons = []; this.busy = false;
        const button = (label, kind, fn) => {
            const node = E('button', { 'class': 'cbi-button cbi-button-action',
                type: 'button', click: () => this.act(fn) }, [label]);
            this.buttons.push({ node, kind }); return node;
        };
        this.table = E('tbody');
        this.volumeLabel = E('output', { 'aria-live': 'polite' }, ['—']);
        this.volume = E('input', { type: 'range', min: 0, max: 100, step: 1,
            'aria-label': _('音量百分比'), input: () => {
                this.volumeEditing = true; this.volumeLabel.textContent = this.volume.value + '%';
            }, change: () => {
                const value = Number(this.volume.value); this.volumeEditing = false;
                if (this.volume.disabled) return;
                return this.act(() => setVolume(value));
            } });
        const controls = [
            button(_('音量 −5'), 'volume', () => adjustVolume(-5)),
            button(_('音量 +5'), 'volume', () => adjustVolume(5)),
            E('span', {}, [this.volume, this.volumeLabel]),
            button(_('麦克风静音'), 'privacy', () => setPrivacy(true)),
            E('button', { 'class': 'cbi-button', type: 'button', click: () => this.unmute() }, [_('解除静音')])
        ];
        this.buttons.push({ node: controls[4], kind: 'privacy' });
        this.serviceHint = E('p');
        this.log = E('pre', { 'class': 'cbi-section', 'aria-live': 'polite' }, [_('遇到问题时，点击“查看日志”获取排查信息。')]);
        const viewNode = E('div', {}, [
            E('h2', {}, [_('Lotus Mini 硬件服务')]),
            E('p', {}, [_('查看电量、温度和硬件状态，调整音量与麦克风静音。')]),
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, [_('当前状态')]),
                E('table', { 'class': 'table cbi-section-table' }, [this.table])]),
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, [_('音量与麦克风')]),
                E('p', {}, [_('拖动音量滑条，松开后生效。麦克风静音会暂停兼容语音应用的录音和唤醒，但不会切断麦克风电源。')]),
                E('div', { 'class': 'cbi-page-actions' }, controls)]),
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, [_('服务管理与灯效测试')]),
                this.serviceHint,
                E('div', { 'class': 'cbi-page-actions' }, [
                    button(_('启动服务'), 'start', () => service('start')),
                    button(_('停止服务'), 'stop', () => service('stop')),
                    button(_('重启服务'), 'stop', () => service('restart')),
                    button(_('开启开机自动运行'), 'enable', () => service('enable')),
                    button(_('关闭开机自动运行'), 'disable', () => service('disable')),
                    button(_('白光测试'), 'led', () => testLed('solid')),
                    button(_('呼吸测试'), 'led', () => testLed('breath')),
                    button(_('渐变测试'), 'led', () => testLed('gradient'))
                ])]),
            E('details', { 'class': 'cbi-section' }, [E('summary', {}, [_('故障排查日志')]),
                E('button', { 'class': 'cbi-button', type: 'button', click: () => getLogs().then(r => {
                    this.log.textContent = r.ok ? r.result.text || _('暂无日志') : explainError(r.error);
                }).catch(() => { this.log.textContent = _('日志读取失败，请检查网络连接后重试。'); }) }, [_('查看日志')]), this.log])
        ]);
        this.update(reply); poll.add(() => this.refresh(), 3);
        return viewNode;
    },
    handleSave: null, handleSaveApply: null, handleReset: null
});
