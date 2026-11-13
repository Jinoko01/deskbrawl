import { useId } from "react";
import type { CharacterSkin } from "@deskbrawl/protocol";
import { characterSkinSchema } from "@deskbrawl/protocol";
import { adjacentCharacter, characterPortrait } from "./game/characters";

interface CharacterPickerProps {
  readonly skin: CharacterSkin;
  readonly disabled: boolean;
  readonly onChange: (skin: CharacterSkin) => void;
}

interface PortraitProps {
  readonly skin: CharacterSkin;
  readonly label?: string;
}

export function CharacterPortrait({ skin, label }: PortraitProps) {
  const { image, frame, size } = characterPortrait(skin);
  return (
    <svg
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined || undefined}
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      className="h-full w-full [image-rendering:pixelated]"
    >
      <image
        href={image}
        width={size.w}
        height={size.h}
      />
    </svg>
  );
}

export function CharacterPicker({ skin, disabled, onChange }: CharacterPickerProps) {
  const labelId = useId();
  const index = characterSkinSchema.options.indexOf(skin);
  const { name } = characterPortrait(skin);
  function step(direction: -1 | 1): void {
    if (!disabled) {
      onChange(adjacentCharacter(skin, direction));
    }
  }

  return (
    <div
      className="character-picker"
      role="group"
      aria-label="캐릭터 선택"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          step(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="character-stage">
        <div className="character-ground" aria-hidden="true" />
        <div className="character-art">
          <div key={skin} className="character-portrait">
            <CharacterPortrait skin={skin} label={`${name} 캐릭터 미리보기`} />
          </div>
        </div>
        <span className="character-number" aria-hidden="true">{`${index + 1} / ${characterSkinSchema.options.length}`}</span>
        <button
          type="button"
          className="character-arrow character-arrow-previous"
          aria-label="이전 캐릭터"
          disabled={disabled}
          onClick={() => step(-1)}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              d="M16 3 5 12l11 9Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="character-arrow character-arrow-next"
          aria-label="다음 캐릭터"
          disabled={disabled}
          onClick={() => step(1)}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              d="m8 3 11 9-11 9Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <p
          id={labelId}
          className="character-name"
          aria-live="polite"
          aria-atomic="true"
        >
          {name}
          <span className="sr-only">{`, ${characterSkinSchema.options.length}종 중 ${index + 1}번째`}</span>
        </p>
      </div>
      <div className="character-options">
        {characterSkinSchema.options.map((id) => (
          <button
            key={id}
            type="button"
            className="character-option"
            aria-label={characterPortrait(id).name}
            aria-pressed={id === skin}
            title={characterPortrait(id).name}
            disabled={disabled}
            onClick={() => onChange(id)}
          >
            <CharacterPortrait skin={id} />
          </button>
        ))}
      </div>
    </div>
  );
}
