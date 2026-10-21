import { useState } from "react";
import type { useMultiplayer } from "./hooks/queries/useMultiplayer";
import { SERVER_ORIGIN } from "./api/rooms";
import { VisitPreview } from "./VisitPreview";

const button = "cursor-pointer rounded-lg border border-border px-3 py-2 text-sm hover:bg-background active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-50";

interface MultiplayerPanelProps {
  readonly game: ReturnType<typeof useMultiplayer>;
  readonly playing: boolean;
}

const CONNECTION_LABELS = {
  host: "내 공간 연결됨",
  guest: "친구 공간 방문 중",
  connecting: "공간에 연결하는 중…",
  local: "로컬 플레이 · 서버 공간에 연결해 주세요.",
  error: "로컬 플레이 · 서버 공간에 연결해 주세요.",
} as const;

export function MultiplayerPanel({ game, playing }: MultiplayerPanelProps) {
  const [nickname, setNickname] = useState("친구");
  const [link, setLink] = useState("");
  const [copy, setCopy] = useState<string>();
  const busy = playing || game.view.phase === "connecting" || game.connect.isPending || game.join.isPending || game.returning.isPending;
  const hosting = game.view.phase === "host";
  const guest = game.view.phase === "guest";
  const error = game.join.error ?? game.invite.error ?? game.revoke.error ?? game.returning.error;
  const invitation = game.invite.data;
  const inviteBusy = busy || game.invite.isPending || game.revoke.isPending;
  const inviteLabel = invitation ? "링크 재발급" : "방문 링크 생성";

  function copyInviteLink(): void {
    if (invitation === undefined) {
      return;
    }
    void navigator.clipboard.writeText(invitation.link).then(
      () => setCopy("링크를 복사했습니다."),
      () => setCopy("복사하지 못했습니다. 위 링크를 직접 선택해 복사해 주세요."),
    );
  }

  return (
    <section className="mt-6 border-t border-border pt-5 text-left" aria-label="링크 방문">
      <h2 className="font-semibold">링크 방문 · 2인</h2>
      <p className="mt-2 break-all text-xs text-muted-foreground">
        {`서버: ${SERVER_ORIGIN}`}
      </p>
      <p className="mt-2 text-sm" role="status">{CONNECTION_LABELS[game.view.phase]}</p>
      {!hosting && !guest && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            game.connect.mutate(nickname);
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            처음 등록할 닉네임
            <input
              className="rounded-lg border border-border bg-background p-2"
              value={nickname}
              maxLength={24}
              required
              disabled={busy}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <button
            className={`${button} self-end`}
            disabled={busy}
            type="submit"
          >
            내 공간 연결
          </button>
        </form>
      )}
      {game.view.members.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {game.view.members.map((name, index) => (
            <li key={`${index}:${name}`}>{name}</li>
          ))}
        </ul>
      )}
      {hosting && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">링크를 가진 누구나 승인 없이 방문할 수 있어요. 호스트 포함 2명까지 입장합니다.</p>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={inviteBusy}
              onClick={() => {
                setCopy(undefined);
                game.invite.mutate();
              }}
            >
              {game.invite.isPending ? "발급 중…" : inviteLabel}
            </button>
            <button
              className={button}
              disabled={inviteBusy}
              onClick={() => {
                setCopy(undefined);
                game.revoke.mutate();
              }}
            >
              링크 폐기
            </button>
          </div>
          {invitation && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                내 방문 링크
                <input
                  readOnly
                  value={invitation.link}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {`만료: ${new Date(invitation.expiresAt).toLocaleString()}`}
              </p>
              <button className={button} onClick={copyInviteLink}>링크 복사</button>
              {copy && <p role="status" className="text-xs">{copy}</p>}
            </>
          )}
        </div>
      )}
      {!guest && (
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            game.join.mutate({ link, nickname });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            친구 방문 링크
            <input
              className="rounded-lg border border-border bg-background p-2 text-sm"
              type="text"
              maxLength={2048}
              value={link}
              required
              disabled={busy}
              onChange={(event) => setLink(event.target.value)}
              placeholder="deskbrawl://join/… 또는 서버 방문 링크"
            />
          </label>
          <button
            type="submit"
            className={button}
            disabled={busy}
          >
            방문하기
          </button>
        </form>
      )}
      {guest && (
        <>
          <VisitPreview subscribe={game.subscribe} />
          <button
            className={`${button} mt-3 w-full`}
            disabled={busy}
            onClick={() => game.returning.mutate()}
          >
            귀환
          </button>
        </>
      )}
      {game.view.error && <p className="mt-3 text-sm" role="alert">{game.view.error}</p>}
      {error && error.message !== game.view.error && <p className="mt-3 text-sm" role="alert">{error.message}</p>}
      {game.room.error && (
        <p className="mt-3 text-sm" role="alert">
          {`내 공간 조회 실패: ${game.room.error.message}`}
        </p>
      )}
    </section>
  );
}
