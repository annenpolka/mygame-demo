import { PAD_ACTIONS, buttonName } from '../input/gamepad';
import type { GamepadControls } from './useGamepad';
const names = {
  confirm: '基本技・決定・積む',
  back: '戻る（予約は変えない）',
  skill: '主力技',
  cutQueue: '後続取消（現在の一手は続行）',
  previous: '前の仲間',
  next: '次の仲間',
  slow: 'スロー',
  rowBack: '後列へ移動',
  rowFront: '前列へ移動',
  weapon: '武器変更',
  pause: '休憩ポーズ',
  menu: '補助メニュー（時間操作・ログも収録）',
  execute: '行動開始（下書きの列を確定）',
  guard: '自分への防御を下書き',
  tactics: '次のオプティマ',
  aux: '補助メニュー',
  up: '上へ',
  down: '下へ',
  left: '左へ',
  right: '右へ',
  targetAllies: '支援対象を選び直す',
  targetEnemies: '攻撃対象を選び直す',
  queue: '予約一覧・取消',
  mark: '今のところに印・休憩中は印一覧',
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
            <option value="pointer">キーボード・マウス用</option>
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
          右トリガーで行動開始、左トリガーで後続取消。4ボタンは基本技・主力技・防御・戻る。左スティックは駒の配置に沿って移動。右スティックの左で味方、右で敵へ切り替えます。十字キーの左右で後列・前列へ移動、上でオプティマ、下で武器変更。R3でスローを切り替えます。右スティックは選び直す側を指定し、攻撃と支援の対象は同時に保持します。十字キー選択の配置では移動・装備変更を補助メニューから使えます。
        </p>
        <label className="pad-family">
          選択の操作方式
          <select
            aria-label="パッドの選択方式"
            value={c.bindings.navigation}
            disabled={!c.pad}
            onChange={(e) => c.setNavigation(e.target.value as 'stick' | 'dpad')}
          >
            <option value="stick">左スティックで選択・十字キーで移動と装備</option>
            <option value="dpad">十字キーで選択・移動と装備は補助メニュー</option>
          </select>
        </label>
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
          {(['axisX', 'axisY', 'sideAxis'] as const).map((k, i) => (
            <label key={k}>
              {['対象移動・横軸', '対象移動・縦軸', '敵味方切替・右スティック横軸'][i]}
              <select
                aria-label={['スティック横軸', 'スティック縦軸', '敵味方切替の軸'][i]}
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
          {(['invertX', 'invertY', 'invertSideAxis'] as const).map((k, i) => (
            <label key={k}>
              <input
                type="checkbox"
                disabled={!c.pad}
                checked={c.bindings[k]}
                onChange={(e) => c.update({ ...c.bindings, [k]: e.target.checked })}
              />
              {['対象移動の左右', '対象移動の上下', '敵味方切替の左右'][i]}を反転
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
