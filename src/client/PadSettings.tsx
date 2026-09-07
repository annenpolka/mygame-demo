import { PAD_ACTIONS, buttonName } from '../input/gamepad';
import type { GamepadControls } from './useGamepad';
const names = {
  confirm: '基本技・決定・積む',
  cancel: '防御・戻る',
  skill: '主力技',
  item: '救急薬・予約を全取消',
  previous: '前の仲間',
  next: '次の仲間',
  slow: 'スロー',
  stop: '戦術停止',
  pause: '休憩ポーズ',
  log: '戦闘ログ',
  up: '上へ',
  down: '下へ',
  left: '左へ',
  right: '右へ',
};
export function PadSettings({
  controls: c,
  onClose,
}: {
  controls: GamepadControls;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop pad-backdrop">
      <section
        className="pad-settings"
        role="dialog"
        aria-modal="true"
        aria-label="ゲームパッド設定"
      >
        <div className="drawer-heading">
          <h2>ゲームパッド</h2>
          <button data-pad-default onClick={onClose}>
            設定を閉じる ×
          </button>
        </div>
        <p>{c.pad ? `接続：${c.pad.id}` : 'パッドを接続し、いずれかのボタンを押してください。'}</p>
        {c.pad && !c.supported && (
          <p className="pad-warning">
            この機器のボタン配置を設定してください。各項目を選び、使うボタンを押すと登録できます。
          </p>
        )}
        <label className="pad-family">
          操作画面
          <select
            aria-label="操作画面"
            value={c.display}
            onChange={(e) => c.setDisplay(e.target.value as GamepadControls['display'])}
          >
            <option value="auto">接続に合わせて自動</option>
            <option value="pad">パッド用コマンド</option>
            <option value="pointer">マウス用の一覧</option>
          </select>
        </label>
        <label className="pad-family">
          ボタン表示
          <select
            aria-label="パッドのボタン表示"
            value={c.chosenFamily}
            onChange={(e) => c.setFamily(e.target.value as GamepadControls['chosenFamily'])}
          >
            <option value="auto">機種から自動判定</option>
            <option value="xbox">Xbox / 標準</option>
            <option value="playstation">PlayStation</option>
            <option value="switch">Switch Pro</option>
          </select>
        </label>
        <p className="muted">
          戦闘では4ボタンから技・防御・薬を直接選べます。肩ボタンで仲間、トリガーで時間を操作。設定中は肩ボタンで項目を切り替えます。割り当ては接続機器ごとに保存します。
        </p>
        <div className="pad-bindings">
          {PAD_ACTIONS.map((a) => (
            <button
              key={a}
              disabled={!c.pad}
              aria-pressed={c.capture === a}
              onClick={() => c.setCapture(c.capture === a ? null : a)}
            >
              <span>{names[a]}</span>
              <b>
                {c.capture === a ? '一度離して、ボタンを押す' : buttonName(c.bindings[a], c.family)}
              </b>
            </button>
          ))}
        </div>
        {c.capture && <button onClick={() => c.setCapture(null)}>割り当てを中止</button>}
        <div className="pad-axes">
          {(['axisX', 'axisY'] as const).map((k, i) => (
            <label key={k}>
              {i ? '縦軸' : '横軸'}
              <select
                aria-label={i ? 'スティック縦軸' : 'スティック横軸'}
                value={c.bindings[k]}
                disabled={!c.pad}
                onChange={(e) => c.update({ ...c.bindings, [k]: Number(e.target.value) })}
              >
                <option value={-1}>使わない</option>
                {Array.from({ length: 8 }, (_, n) => (
                  <option value={n} key={n}>
                    軸 {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {(['invertX', 'invertY'] as const).map((k, i) => (
            <label key={k}>
              <input
                type="checkbox"
                disabled={!c.pad}
                checked={c.bindings[k]}
                onChange={(e) => c.update({ ...c.bindings, [k]: e.target.checked })}
              />
              {i ? '上下' : '左右'}を反転
            </label>
          ))}
        </div>
        <button disabled={!c.pad} onClick={c.reset}>
          このパッドの割り当てを初期化
        </button>
        <p className="muted">
          接続が切れると休憩ポーズに入ります。再接続後はボタンを離してから再開してください。
        </p>
        {c.error && <p>{c.error}</p>}
      </section>
    </div>
  );
}
