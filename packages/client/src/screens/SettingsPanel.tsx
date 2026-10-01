import { DEFAULT_SETTINGS, SETTING_LIMITS, endThreshold, type RoomSettings, type RoomView } from '@tcd/shared';
import type { ReactNode } from 'react';
import { socket } from '../net';
import './settings.css';

/** Lobby room settings. The host edits; everyone else sees the same panel read-only. */
export function SettingsPanel({ room }: { room: RoomView }) {
  const s = room.settings;
  const n = room.members.length;
  const editable = room.hostId === room.youId;
  const set = (p: Partial<RoomSettings>) => editable && socket.emit('room:settings', p);

  const rounds = endThreshold(n, s.rounds);
  const custom = s.rounds > 0;
  // Very rough: a human turn takes ~40 s, AI turns ~8 s.
  const humans = room.members.filter((m) => !m.isBot).length;
  const minutes = Math.max(1, Math.round((rounds * (humans * 40 + (n - humans) * 8)) / 60));
  const botSpeed = s.botDelay <= 600 ? 400 : s.botDelay <= 1200 ? 900 : 1600;

  return (
    <section className={`opts ${editable ? '' : 'is-readonly'}`} aria-label="房间设置">
      <header className="opts__head">
        <h3>房间设置</h3>
        <span className="opts__hint">{editable ? '你是房主，可以修改' : '仅房主可修改'}</span>
        {editable && (
          <button className="btn btn--ghost btn--sm" onClick={() => set({ ...DEFAULT_SETTINGS, promptTimeout: DEFAULT_SETTINGS.promptTimeout })}>
            恢复默认
          </button>
        )}
      </header>

      <div className="opts__grid">
        <Card title="游戏长度" sub={`共 ${rounds} 轮 · 约 ${minutes} 分钟`} wide>
          <Segmented
            value={custom ? 'custom' : 'auto'}
            options={[
              { value: 'auto', label: `标准 · 12−人数` },
              { value: 'custom', label: '自定义' },
            ]}
            onChange={(v) => set({ rounds: v === 'auto' ? 0 : Math.min(12, Math.max(2, endThreshold(n))) })}
            disabled={!editable}
          />
          {custom && (
            <Stepper
              value={s.rounds}
              min={SETTING_LIMITS.rounds[0]}
              max={SETTING_LIMITS.rounds[1]}
              unit="轮"
              onChange={(v) => set({ rounds: v })}
              disabled={!editable}
            />
          )}
          <p className="opts__note">官作弃牌堆达到这么多张后进入最终结算。每轮每位玩家一个回合。</p>
        </Card>

        <Card title="开局手牌" sub="每人起手的行动牌">
          <Stepper value={s.startingHand} min={SETTING_LIMITS.startingHand[0]} max={SETTING_LIMITS.startingHand[1]} unit="张" onChange={(v) => set({ startingHand: v })} disabled={!editable} />
        </Card>

        <Card title="先手" sub="谁先行动">
          <Segmented
            value={s.firstPlayer}
            options={[{ value: 'random', label: '🎲 随机' }, { value: 'host', label: '👑 房主' }]}
            onChange={(v) => set({ firstPlayer: v as RoomSettings['firstPlayer'] })}
            disabled={!editable}
          />
        </Card>

        <Card title="角色" sub="开局发给每人几张候选角色">
          <Stepper value={s.roleChoices} min={SETTING_LIMITS.roleChoices[0]} max={SETTING_LIMITS.roleChoices[1]} unit="张" onChange={(v) => set({ roleChoices: v })} disabled={!editable} />
          <Toggle label="平衡阵营" hint="每人至少有一张繁荣、一张小众角色可选" value={s.balancedRoles} onChange={(v) => set({ balancedRoles: v })} disabled={!editable} />
        </Card>

        <Card title="操作时限" sub="超时自动选择默认项；连续两次超时由 AI 托管">
          <Chips
            value={s.promptTimeout}
            options={[0, 30, 60, 90, 120, 180].map((v) => ({ value: v, label: v ? `${v}秒` : '不限' }))}
            onChange={(v) => set({ promptTimeout: v })}
            disabled={!editable}
          />
        </Card>

        <Card title="AI 速度" sub="AI 思考的停顿，方便看清局面">
          <Segmented
            value={String(botSpeed)}
            options={[{ value: '400', label: '快' }, { value: '900', label: '适中' }, { value: '1600', label: '慢' }]}
            onChange={(v) => set({ botDelay: Number(v) })}
            disabled={!editable}
          />
        </Card>

        <Card title="演出节奏" sub="出牌、技能与数值变化的停留时间">
          <Segmented
            value={s.pace}
            options={[{ value: 'quick', label: '快速' }, { value: 'normal', label: '标准' }, { value: 'epic', label: '华丽' }]}
            onChange={(v) => set({ pace: v as RoomSettings['pace'] })}
            disabled={!editable}
          />
        </Card>

        <Card title="观战" sub="允许没有座位的人旁观进行中的游戏">
          <Toggle label="允许观战" value={s.allowSpectators} onChange={(v) => set({ allowSpectators: v })} disabled={!editable} />
        </Card>
      </div>
    </section>
  );
}

function Card({ title, sub, wide, children }: { title: string; sub: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`opt ${wide ? 'opt--wide' : ''}`}>
      <div className="opt__title">{title}</div>
      <div className="opt__sub">{sub}</div>
      <div className="opt__body">{children}</div>
    </div>
  );
}

function Segmented({ value, options, onChange, disabled }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'is-on' : ''} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, unit, onChange, disabled }: {
  value: number; min: number; max: number; unit: string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="stp">
      <button type="button" aria-label="减少" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output><b>{value}</b> {unit}</output>
      <button type="button" aria-label="增加" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>＋</button>
    </div>
  );
}

function Chips({ value, options, onChange, disabled }: {
  value: number; options: { value: number; label: string }[]; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'is-on' : ''} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, value, onChange, disabled }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`tog ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="tog__track"><i /></span>
      <span className="tog__text">{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}
