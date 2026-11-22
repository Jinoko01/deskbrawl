import { useEffect, useRef, useState } from "react";
import { nicknameSchema } from "@deskbrawl/protocol";
import type { CharacterSkin } from "@deskbrawl/protocol";
import type { useMultiplayer } from "./hooks/queries/useMultiplayer";
import { roomErrorMessage, SERVER_ORIGIN } from "./api/rooms";
import { AppIcon } from "./AppIcon";
import { CharacterPicker, CharacterPortrait } from "./CharacterPicker";
import { CHARACTERS } from "./game/characters";
import { copyInvite } from "./native/focus";
import { VisitPreview } from "./VisitPreview";

interface MultiplayerPanelProps {
  readonly game: ReturnType<typeof useMultiplayer>;
  readonly playing: boolean;
  readonly highlight: "space" | "visit" | null;
}

const CONNECTION_LABELS = {
  host: "내 공간 연결됨",
  guest: "친구 공간 방문 중",
  connecting: "공간에 연결하는 중…",
  reconnecting: "연결이 끊겨 복구하는 중… 조작을 잠시 멈췄어요.",
  local: "연결 전",
  error: "연결 끊김",
} as const;

const inviteExpiry = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export function MultiplayerPanel({ game, playing, highlight }: MultiplayerPanelProps) {
  const [nicknameEdit, setNickname] = useState<string>();
  const [skinDraft, setSkinDraft] = useState<CharacterSkin>();
  const nickname = nicknameEdit ?? (skinDraft === undefined ? game.nickname : game.savedNickname ?? CHARACTERS[skinDraft].name);
  const [link, setLink] = useState("");
  const [copy, setCopy] = useState<string>();
  const [profileSaved, setProfileSaved] = useState(false);
  const disconnectDialog = useRef<HTMLDialogElement>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const connectionBusy = game.connectionBusy;
  const controlBusy = playing || connectionBusy || game.focus.isPending || game.kick.isPending || game.clearVisitors.isPending;
  const busy = controlBusy || game.profile.isPending;
  const hosting = game.view.phase === "host";
  const guest = game.view.phase === "guest";
  const connected = hosting || guest;
  const error = game.disconnecting.error ?? (hosting
    ? game.kick.error ?? game.clearVisitors.error ?? game.invite.error ?? game.revoke.error
    : null);
  const visitError = game.join.isError ? roomErrorMessage(game.join.error) : undefined;
  const invitation = game.invite.data;
  const inviteBusy = busy || game.invite.isPending || game.revoke.isPending;
  const visitors = game.view.members.filter((member) => member.role === "guest");
  const nicknameValid = nicknameSchema.safeParse(nickname).success;
  const canSaveNickname = nicknameValid && nickname.trim() !== game.self?.nickname;
  const nicknameHelp = nicknameValid ? "1~12자로 입력해 주세요." : "닉네임은 앞뒤 공백을 빼고 1~12자여야 해요.";
  const lobbyHelp = playing ? "플레이 중에는 캐릭터와 연결을 바꿀 수 없어요. Esc를 눌러 작업 모드로 돌아와 주세요." : undefined;
  const canCancel = !game.disconnecting.isPending && (
    game.connect.isPending || game.join.isPending || game.returning.isPending
    || game.view.phase === "connecting" || game.view.phase === "reconnecting"
  );
  const mutateProfile = game.profile.mutate;
  useEffect(() => {
    if (skinDraft === undefined || busy) {
      return;
    }
    // Preview each step immediately; only publish the settled choice to the rate-limited server.
    const timer = window.setTimeout(() => {
      const settle = () => setSkinDraft((current) => current === skinDraft ? undefined : current);
      mutateProfile({ skin: skinDraft }, { onSuccess: settle, onError: settle });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [skinDraft, busy, mutateProfile]);
  useEffect(() => {
    if (copy !== undefined) {
      const timer = window.setTimeout(() => setCopy(undefined), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [copy]);

  function copyInviteLink(): void {
    if (invitation === undefined) {
      return;
    }
    void copyInvite(invitation.link).then(
      () => setCopy("링크를 복사했어요."),
      () => setCopy("링크를 복사하지 못했어요. 방문 링크를 선택해 직접 복사해 주세요."),
    );
  }

  function saveProfile(): void {
    setProfileSaved(false);
    if (connected) {
      game.profile.mutate({ nickname }, {
        onSuccess: () => {
          setNickname(undefined);
          setProfileSaved(true);
        },
      });
    } else {
      game.connect.mutate({ nickname: nickname.trim(), edited: nicknameEdit !== undefined });
    }
  }

  return (
    <section aria-label="캐릭터와 공간 연결" className="lobby-grid">
      {lobbyHelp && <p className="notice lobby-notice" role="status">{lobbyHelp}</p>}
      <section className="panel profile-panel" aria-labelledby="profile-title">
        <div className="panel-heading">
          <h2 id="profile-title">나의 캐릭터</h2>
        </div>
        <CharacterPicker
          skin={skinDraft ?? game.skin}
          disabled={busy}
          onChange={setSkinDraft}
        />
        <form
          id="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && nicknameValid && (!connected || canSaveNickname)) {
              saveProfile();
            }
          }}
        >
          <label className="field-label">
            닉네임
            <input
              className="field"
              value={nickname}
              maxLength={12}
              required
              disabled={busy}
              aria-invalid={!nicknameValid || undefined}
              aria-describedby="nickname-help"
              autoComplete="nickname"
              onChange={(event) => {
                setNickname(event.target.value);
                setProfileSaved(false);
              }}
            />
          </label>
          <p id="nickname-help" className={nicknameValid ? "field-help" : "field-help text-danger"}>{nicknameHelp}</p>
          {connected && (
            <button
              className="button button-secondary mt-3 w-full"
              disabled={busy || !canSaveNickname}
              type="submit"
            >
              {game.profile.isPending ? "저장 중…" : "닉네임 저장"}
            </button>
          )}
        </form>
        {profileSaved && nicknameEdit === undefined && <p className="mt-2 text-xs text-accent" role="status">닉네임을 저장했어요.</p>}
        {game.profile.error && <p className="notice notice-error" role="alert">{roomErrorMessage(game.profile.error)}</p>}
      </section>
      <div className="room-column">
        <section className="panel room-panel" aria-labelledby="room-title">
          <div className="panel-heading">
            <h2 id="room-title">{guest ? "방문 중인 공간" : "내 공간"}</h2>
            {connected && (
              <span className="room-capacity" aria-label={`최대 6명 중 ${game.view.members.length}명 참여 중`}>
                <AppIcon name="people" />
                {`${game.view.members.length} / 6`}
              </span>
            )}
            <div className="room-status" data-connected={connected}>
              <p role="status">{game.disconnecting.isPending ? "연결을 정리하는 중…" : CONNECTION_LABELS[game.view.phase]}</p>
            </div>
          </div>
          {!connected && (
            <div className="room-empty">
              <p>내 공간을 열고 방문 링크로 친구를 초대해요. 최대 6명이 함께할 수 있어요.</p>
              <button
                className="button button-secondary"
                data-coach-target={highlight === "space" || undefined}
                type="submit"
                form="profile-form"
                disabled={busy || !nicknameValid}
                aria-describedby={!nicknameValid ? "nickname-help" : undefined}
              >
                {game.connect.isPending ? "연결하는 중…" : "내 공간 연결"}
                <AppIcon name="arrow" />
              </button>
            </div>
          )}
          {canCancel && (
            <button
              type="button"
              className="button button-secondary mt-3 w-full"
              onClick={() => game.disconnecting.mutate()}
            >
              연결 취소
            </button>
          )}
          {connected && (
            <>
              <ul aria-label="공간 참여자" className="member-list">
                {game.view.members.map((member) => (
                  <li key={member.playerId}>
                    <span className="member-avatar" aria-hidden="true">
                      {member.skin === undefined ? member.nickname.slice(0, 1) : <CharacterPortrait skin={member.skin} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium">
                        {member.nickname}
                        {member.playerId === game.self?.playerId && <span className="ml-1 text-xs text-muted-foreground">(나)</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{member.role === "host" ? "호스트" : "방문자"}</p>
                    </div>
                    {hosting && member.role === "guest" && (
                      <button
                        type="button"
                        className="button button-quiet"
                        aria-label={`${member.nickname} 내보내기`}
                        disabled={controlBusy}
                        onClick={() => game.kick.mutate(member.playerId)}
                      >
                        {game.kick.isPending && game.kick.variables === member.playerId ? "내보내는 중…" : "내보내기"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {hosting && (
            <div className="invite-section">
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                링크를 가진 누구나 승인 없이 방문할 수 있어요.
                {game.focused && " 집중 모드를 끄면 친구가 방문할 수 있어요."}
              </p>
              {!invitation && (
                <button
                  type="button"
                  className="button button-primary w-full"
                  data-coach-target={highlight === "space" || undefined}
                  disabled={inviteBusy}
                  onClick={() => {
                    setCopy(undefined);
                    game.invite.mutate();
                  }}
                >
                  <AppIcon name="link" />
                  {game.invite.isPending ? "발급 중…" : "방문 링크 생성"}
                </button>
              )}
              {invitation && (
                <>
                  <label className="field-label">
                    내 방문 링크
                    <input
                      readOnly
                      value={invitation.link}
                      className="field text-xs"
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button-primary mt-3 w-full"
                    data-coach-target={highlight === "space" || undefined}
                    onClick={copyInviteLink}
                  >
                    <AppIcon name="link" />
                    링크 복사
                  </button>
                  {copy && <p role="status" className="mt-2 text-xs text-accent">{copy}</p>}
                  <details className="link-management">
                    <summary>링크 관리</summary>
                    <p className="mt-2 text-xs text-muted-foreground">{`${inviteExpiry.format(invitation.expiresAt)}에 만료돼요.`}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">재발급하거나 폐기하면 기존 링크로는 새로 방문할 수 없어요.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={inviteBusy}
                        onClick={() => {
                          setCopy(undefined);
                          game.invite.mutate();
                        }}
                      >
                        {game.invite.isPending ? "발급 중…" : "링크 재발급"}
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        disabled={inviteBusy}
                        onClick={() => {
                          setCopy(undefined);
                          game.revoke.mutate();
                        }}
                      >
                        {game.revoke.isPending ? "폐기 중…" : "링크 폐기"}
                      </button>
                    </div>
                  </details>
                </>
              )}
              {visitors.length > 0 && (
                <button
                  type="button"
                  className="button button-danger mt-3"
                  disabled={controlBusy}
                  onClick={() => clearDialog.current?.showModal()}
                >
                  {game.clearVisitors.isPending ? "내보내는 중…" : "모두 내보내기"}
                </button>
              )}
              <button
                type="button"
                className="button button-quiet mt-3"
                disabled={inviteBusy}
                onClick={() => {
                  if (visitors.length > 0) {
                    disconnectDialog.current?.showModal();
                  } else {
                    game.disconnecting.mutate();
                  }
                }}
              >
                공간 연결 끊기
              </button>
            </div>
          )}
          {guest && (
            <>
              <VisitPreview subscribe={game.subscribe} />
              <button
                type="button"
                className="button button-primary mt-4 w-full"
                data-coach-target={highlight !== null || undefined}
                disabled={busy}
                onClick={() => game.returning.mutate()}
              >
                {game.returning.isPending ? "돌아가는 중…" : "내 공간으로 돌아가기"}
                <AppIcon name="arrow" />
              </button>
            </>
          )}
          {game.view.notice && <p className="notice" role="status">{game.view.notice}</p>}
          {game.view.error && game.view.error !== visitError && <p className="notice notice-error" role="alert">{game.view.error}</p>}
          {error && <p className="notice notice-error" role="alert">{roomErrorMessage(error)}</p>}
          {game.room.error && connected && <p className="notice notice-error" role="alert">{roomErrorMessage(game.room.error)}</p>}
        </section>
        {!guest && (
          <section className="panel visit-panel" aria-labelledby="visit-title">
            <div className="panel-heading">
              <h2 id="visit-title">
                친구에게 놀러 가기
              </h2>
            </div>
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !game.focused && link.trim().length > 0 && nicknameValid) {
                game.join.mutate({ link: link.trim(), nickname: nickname.trim(), edited: nicknameEdit !== undefined });
              }
            }}
            >
              <div className="visit-link-controls" data-coach-target={highlight === "visit" || undefined}>
                <label className="field-label">
                  친구 방문 링크
                  <input
                    className="field text-xs"
                    type="text"
                    maxLength={2048}
                    value={link}
                    required
                    disabled={busy || game.focused}
                    aria-invalid={game.join.isError || undefined}
                    aria-describedby={visitError === undefined ? undefined : "visit-error"}
                    onChange={(event) => {
                      setLink(event.target.value);
                      if (game.join.isError) {
                        game.join.reset();
                      }
                    }}
                    placeholder="방문 링크를 붙여넣어 주세요"
                  />
                </label>
                <button
                  type="submit"
                  className="button button-secondary"
                  disabled={busy || game.focused || !link.trim() || !nicknameValid}
                  aria-describedby={!nicknameValid ? "nickname-help" : undefined}
                >
                  {game.join.isPending ? "방문하는 중…" : "방문하기"}
                  <AppIcon name="arrow" />
                </button>
              </div>
              {game.focused && <p className="mt-2 text-xs text-muted-foreground">집중 모드를 끄면 친구 공간에 방문할 수 있어요.</p>}
              {visitError && (
                <p
                  id="visit-error"
                  className="notice notice-error"
                  role="alert"
                >
                  {visitError}
                </p>
              )}
            </form>
          </section>
        )}
        <details className="connection-details">
          <summary>연결 정보</summary>
          <p className="mt-2 break-all text-xs text-muted-foreground">{`서버: ${SERVER_ORIGIN}`}</p>
        </details>
      </div>
      <dialog
        ref={disconnectDialog}
        className="confirm-dialog"
        aria-labelledby="disconnect-title"
        aria-describedby="disconnect-detail"
      >
        <h2 id="disconnect-title" className="font-semibold">공간 연결을 끊을까요?</h2>
        <p id="disconnect-detail" className="mt-2 text-sm text-muted-foreground">내 공간에 있는 방문자의 연결도 끊겨요.</p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <button className="button button-secondary" autoFocus>취소</button>
          <button className="button button-danger" onClick={() => game.disconnecting.mutate()}>연결 끊기</button>
        </form>
      </dialog>
      <dialog
        ref={clearDialog}
        className="confirm-dialog"
        aria-labelledby="clear-title"
        aria-describedby="clear-detail"
      >
        <h2 id="clear-title" className="font-semibold">방문자를 모두 내보낼까요?</h2>
        <p id="clear-detail" className="mt-2 text-sm text-muted-foreground">
          내 공간에 있는 방문자
          {visitors.length}
          명의 연결이 끊겨요.
        </p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <button className="button button-secondary" autoFocus>취소</button>
          <button className="button button-danger" onClick={() => game.clearVisitors.mutate()}>모두 내보내기</button>
        </form>
      </dialog>
    </section>
  );
}
