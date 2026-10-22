import { useEffect, useState } from "react";
import type { CharacterSkin } from "@deskbrawl/protocol";
import type { useMultiplayer } from "./hooks/queries/useMultiplayer";
import { SERVER_ORIGIN } from "./api/rooms";
import { AppIcon } from "./AppIcon";
import { CharacterPicker } from "./CharacterPicker";
import { VisitPreview } from "./VisitPreview";

interface MultiplayerPanelProps {
  readonly game: ReturnType<typeof useMultiplayer>;
  readonly playing: boolean;
}

const CONNECTION_LABELS = {
  host: "내 공간 연결됨",
  guest: "친구 공간 방문 중",
  connecting: "공간에 연결하는 중…",
  reconnecting: "연결이 끊겨 복구하는 중… 조작을 잠시 멈췄어요.",
  local: "로컬 플레이 · 공간 연결 전",
  error: "연결하지 못했어요. 아래 안내를 확인하고 다시 시도해 주세요.",
} as const;

export function MultiplayerPanel({ game, playing }: MultiplayerPanelProps) {
  const [nicknameEdit, setNickname] = useState<string>();
  const nickname = nicknameEdit ?? game.self?.nickname ?? "친구";
  const [link, setLink] = useState("");
  const [copy, setCopy] = useState<string>();
  const [profileSaved, setProfileSaved] = useState(false);
  const [skinDraft, setSkinDraft] = useState<CharacterSkin>();
  const connectionBusy = !game.focusLoaded || ["connecting", "reconnecting"].includes(game.view.phase) || game.connect.isPending || game.join.isPending || game.returning.isPending;
  const controlBusy = connectionBusy || game.focus.isPending || game.kick.isPending || game.clearVisitors.isPending;
  const busy = playing || controlBusy || game.profile.isPending;
  const hosting = game.view.phase === "host";
  const guest = game.view.phase === "guest";
  const connected = hosting || guest;
  const error = game.invite.error ?? game.revoke.error ?? game.returning.error;
  const visitError = game.join.error?.message;
  const invitation = game.invite.data;
  const inviteBusy = busy || game.invite.isPending || game.revoke.isPending;
  const visitors = game.view.members.filter((member) => member.role === "guest");
  const nicknameValid = nickname.trim().length > 0;
  const canSaveNickname = nicknameValid && nickname.trim() !== game.self?.nickname;
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
  let roomTitle = "친구가 찾아올 나의 공간";
  if (guest) {
    roomTitle = "함께하는 친구의 공간";
  } else if (hosting) {
    roomTitle = "친구를 초대해 보세요";
  }

  function copyInviteLink(): void {
    if (invitation === undefined) {
      return;
    }
    void navigator.clipboard.writeText(invitation.link).then(
      () => setCopy("링크를 복사했습니다."),
      () => setCopy("복사하지 못했습니다. 방문 링크를 직접 선택해 복사해 주세요."),
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
      game.connect.mutate(nickname, { onSuccess: () => setNickname(undefined) });
    }
  }

  return (
    <section aria-label="링크 방문" className="lobby-grid">
      <section className="panel profile-panel" aria-labelledby="profile-title">
        <div className="panel-heading">
          <h2 id="profile-title">나의 캐릭터</h2>
          <span className="eyebrow">함께할 작은 친구</span>
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
            if (!busy && nicknameValid) {
              saveProfile();
            }
          }}
        >
          <label className="field-label">
            닉네임
            <input
              className="field"
              value={nickname}
              maxLength={24}
              required
              disabled={busy}
              autoComplete="nickname"
              onChange={(event) => {
                setNickname(event.target.value);
                setProfileSaved(false);
              }}
            />
          </label>
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
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          캐릭터는 선택하면 바로 적용돼요.
          <br />
          연결 후에도 닉네임을 바꿀 수 있어요.
        </p>
        {game.profile.isPending && <p className="mt-2 text-xs text-accent" role="status">프로필 저장 중…</p>}
        {profileSaved && nicknameEdit === undefined && <p className="mt-2 text-xs text-accent" role="status">닉네임을 저장했습니다.</p>}
        {game.profile.error && <p className="notice notice-error" role="alert">{game.profile.error.message}</p>}
      </section>
      <div className="room-column">
        <section className="panel room-panel" aria-labelledby="room-title">
          <div className="panel-heading">
            <h2 id="room-title">{guest ? "방문 중인 공간" : "내 공간"}</h2>
            <span className="room-capacity">
              <AppIcon name="people" />
              {`${game.view.members.length} / 6`}
            </span>
          </div>
          <div className="room-status" data-connected={connected}>
            <span className="status-dot" />
            <p role="status">{CONNECTION_LABELS[game.view.phase]}</p>
          </div>
          {!connected && (
            <div className="room-empty">
              <div className="room-illustration" aria-hidden="true">
                <AppIcon name="home" className="h-8 w-8" />
                <span className="room-orbit" />
                <span className="room-orbit room-orbit-small" />
              </div>
              <h3>{roomTitle}</h3>
              <p>
                캐릭터와 닉네임을 고른 뒤 연결하세요.
                <br />
                내 데스크톱에서 최대 6명이 함께할 수 있어요.
              </p>
              <button
                className="button button-primary w-full"
                type="submit"
                form="profile-form"
                disabled={busy || !nicknameValid}
              >
                {connectionBusy ? "연결하는 중…" : "내 공간 연결"}
                <AppIcon name="arrow" />
              </button>
            </div>
          )}
          {connected && (
            <>
              <h3 className="mt-4 text-base font-semibold">{roomTitle}</h3>
              <ul aria-label="공간 참여자" className="member-list">
                {game.view.members.map((member) => (
                  <li key={member.playerId}>
                    <span className="member-avatar" aria-hidden="true">{member.nickname.slice(0, 1)}</span>
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
                {game.focused && " 집중 모드를 끄면 방문할 수 있어요."}
              </p>
              {!invitation && (
                <button
                  type="button"
                  className="button button-primary w-full"
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
                    onClick={copyInviteLink}
                  >
                    <AppIcon name="link" />
                    링크 복사
                  </button>
                  {copy && <p role="status" className="mt-2 text-xs text-accent">{copy}</p>}
                  <details className="link-management">
                    <summary>링크 관리</summary>
                    <p className="mt-2 text-xs text-muted-foreground">{`만료: ${new Date(invitation.expiresAt).toLocaleString()}`}</p>
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
              {visitors.length === 0 && <p className="mt-3 text-xs text-muted-foreground">아직 방문자가 없어요. 링크를 보내 친구를 초대하세요.</p>}
              {visitors.length > 0 && (
                <button
                  type="button"
                  className="button button-danger mt-3"
                  disabled={controlBusy}
                  onClick={() => game.clearVisitors.mutate()}
                >
                  {game.clearVisitors.isPending ? "내보내는 중…" : "모두 내보내기"}
                </button>
              )}
            </div>
          )}
          {guest && (
            <>
              <VisitPreview subscribe={game.subscribe} />
              <button
                type="button"
                className="button button-primary mt-4 w-full"
                disabled={busy}
                onClick={() => game.returning.mutate()}
              >
                {game.returning.isPending ? "돌아가는 중…" : "귀환"}
                <AppIcon name="arrow" />
              </button>
            </>
          )}
          {game.view.error && game.view.error !== visitError && <p className="notice notice-error" role="alert">{game.view.error}</p>}
          {error && error.message !== game.view.error && <p className="notice notice-error" role="alert">{error.message}</p>}
          {game.room.error && <p className="notice notice-error" role="alert">{`내 공간 조회 실패: ${game.room.error.message}`}</p>}
        </section>
        {!guest && (
          <section className="panel visit-panel" aria-labelledby="visit-title">
            <div className="panel-heading">
              <h2 id="visit-title">
                <AppIcon name="link" />
                친구에게 놀러 가기
              </h2>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">초대받은 링크가 있다면 바로 방문할 수 있어요.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !game.focused && link.trim().length > 0 && nicknameValid) {
                game.join.mutate({ link: link.trim(), nickname });
              }
            }}
            >
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
                  placeholder="초대 링크를 붙여넣으세요"
                />
              </label>
              <button
                type="submit"
                className="button button-secondary mt-3 w-full"
                disabled={busy || game.focused || !link.trim() || !nicknameValid}
              >
                {game.join.isPending ? "방문하는 중…" : "방문하기"}
                <AppIcon name="arrow" />
              </button>
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
    </section>
  );
}
