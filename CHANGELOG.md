# Changelog

## [Unreleased]

### Added

- 샌드백 온오프 추가
- Windows 설치 파일을 자동으로 빌드해 릴리스 초안에 첨부하고, 공개 후 웹사이트에서 최신 안정 버전을 다운로드할 수 있도록 연결
- `pnpm desktop:version <버전>`으로 데스크톱 버전 파일과 `Cargo.lock`을 한 번에 갱신

### Fixed

- 공간 연결 중 인증 토큰이 만료되어 연결이 끊기던 문제 수정
