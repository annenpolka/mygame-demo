import { useRef, useState } from 'react';
import { FEELINGS, NOTE_LIMIT, sameRules, type PlayNote } from '../lab/playtest';
const pages = {
  command: 'コマンド',
  target: '対象選択',
  move: '列変更',
  weapon: '武器変更',
  tactics: '全員への指示',
  queue: '予約取消',
  log: 'ログ',
  aux: '補助メニュー',
};
export function PlaytestNotes({
  notes,
  error,
  close,
  change,
  remove,
  resume,
  compare,
  save,
  load,
}: {
  notes: PlayNote[];
  error: string;
  close: () => void;
  change: (id: string, patch: Pick<PlayNote, 'comment' | 'feeling'>) => void;
  remove: (id: string) => void;
  resume: (note: PlayNote, point: 'before' | 'marked' | 'entry') => void;
  compare: (note: PlayNote) => void;
  save: () => void;
  load: (file: File) => void;
}) {
  const [selected, setSelected] = useState(notes.at(-1)?.id ?? '');
  const upload = useRef<HTMLInputElement>(null);
  const note = notes.find((n) => n.id === selected) ?? notes.at(-1);
  return (
    <div className="playtest-backdrop">
      <section
        className="playtest-notes"
        role="dialog"
        aria-modal="true"
        aria-label="気になった場面"
      >
        <header>
          <div>
            <span className="eyebrow">
              PLAY NOTES · {notes.length}/{NOTE_LIMIT}
            </span>
            <h2>あの場面を、もう一度。</h2>
          </div>
          <button data-pad-default onClick={close}>
            印の一覧を閉じる Esc
          </button>
        </header>
        <p>
          戦闘中に M ／ L3
          ／「今のところ」で印。感想は後から書けます。元の記録は残したまま再操作します。
        </p>
        {error && (
          <p className="playtest-error" role="alert">
            {error}
          </p>
        )}
        <div className="playtest-body">
          <nav aria-label="記録した印">
            {[...notes].reverse().map((n, i) => (
              <button key={n.id} aria-pressed={n.id === note?.id} onClick={() => setSelected(n.id)}>
                <strong>
                  印 {notes.length - i} · 第{n.marked.state.encounter}戦{' '}
                  {n.marked.state.time.toFixed(1)}秒
                </strong>
                <small>{n.comment || FEELINGS[n.feeling]}</small>
              </button>
            ))}
          </nav>
          {note ? (
            <article key={note.id} aria-label="選んだ場面">
              <h3>
                {note.marked.state.allies[note.marked.state.selected].name} ·{' '}
                {pages[note.marked.view.battle.page]}
              </h3>
              <p>
                {note.sourceId ? '印からの再試行で記録した場面' : '元のプレイで記録した場面'} ·{' '}
                {note.recording.version}
              </p>
              <label>
                どんな感じだった？
                <select
                  aria-label="場面の分類"
                  value={note.feeling}
                  onChange={(e) =>
                    change(note.id, {
                      comment: note.comment,
                      feeling: e.target.value as PlayNote['feeling'],
                    })
                  }
                >
                  {Object.entries(FEELINGS).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ひとこと（任意）
                <textarea
                  aria-label="場面へのコメント"
                  value={note.comment}
                  maxLength={300}
                  rows={3}
                  placeholder="迷ったことも、気持ちよかったことも。"
                  onChange={(e) =>
                    change(note.id, { comment: e.target.value, feeling: note.feeling })
                  }
                />
              </label>
              <div className="playtest-retry">
                <strong>同じ版で再操作</strong>
                <p>
                  選択キャラ・対象・開いていた操作画面も戻します。準備できたら操作を再開できます。
                </p>
                {!sameRules(note) && (
                  <p>
                    記録時とルールが異なるため、途中からの再操作は使えません。下の「遭遇開始から比較」を使えます。
                  </p>
                )}
                <button
                  className="primary"
                  disabled={!sameRules(note)}
                  onClick={() => resume(note, 'before')}
                >
                  約{(note.marked.state.realTime - note.before.state.realTime).toFixed(1)}
                  秒前から再操作
                </button>
                <button disabled={!sameRules(note)} onClick={() => resume(note, 'marked')}>
                  印の瞬間から再操作
                </button>
                <button disabled={!sameRules(note)} onClick={() => resume(note, 'entry')}>
                  この遭遇の最初から再操作
                </button>
              </div>
              <details>
                <summary>現在のルールで、遭遇開始から比較</summary>
                <p>
                  記録の持ち込み・オプティマ・隊列を使い、HP・ATB・進行中の行動を初期化して開始します。記録時の途中状態の再現とは別の試行です。
                </p>
                <button onClick={() => compare(note)}>現在のルールで遭遇開始から比較</button>
              </details>
              <button className="playtest-delete" onClick={() => remove(note.id)}>
                この印を削除
              </button>
            </article>
          ) : (
            <article>
              <h3>まだ印がありません。</h3>
              <p>戦闘中の「今のところ」を押してください。戦闘と集中力を止めずに記録します。</p>
            </article>
          )}
        </div>
        <footer>
          <span>このブラウザに保存 · JSONでも持ち出せます</span>
          <button disabled={!notes.length} onClick={save}>
            印をJSON保存
          </button>
          <button onClick={() => upload.current?.click()}>印のJSONを読み込む</button>
          <input
            ref={upload}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="印のJSONファイル"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) load(file);
              e.target.value = '';
            }}
          />
        </footer>
      </section>
    </div>
  );
}
