# Lightsail 서버 자동 배포 설정

서버 관련 변경을 `main`에 직접 push하면 GitHub Actions가 검증한 이미지를 GitHub Container Registry(GHCR)에 발행한다. Lightsail은 약 2분마다 `production` 태그를 확인하고, 새 이미지가 있으면 `server` 서비스만 교체한다. 서버 교체 시 Socket.IO 연결과 진행 중인 메모리 월드가 끊기므로 첫 적용은 이용이 적은 시간에 진행한다.

## GitHub 준비하기

1. Actions에서 **Server deployment** 워크플로를 사용할 수 있는지 확인한다. `main` Ruleset에서 직접 push를 허용하고 강제 push와 브랜치 삭제를 차단한다.
2. Lightsail에서 `uname -m`과 `docker compose version`을 확인한다. 같은 인스턴스에서 `systemctl`, `flock`, `curl`을 사용할 수 있어야 한다. Compose의 `up --help`에서 `--wait` 지원을 확인한다.
3. GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에 `DESKBRAWL_SERVER_PLATFORM`을 추가한다. Lightsail의 `x86_64`에는 `linux/amd64`, `aarch64`에는 `linux/arm64`를 지정한다. 변수가 비어 있으면 CI가 실행되고 이미지 발행 작업은 건너뛴다.
4. 운영 DB에 적용된 마이그레이션과 현재 `main`의 스키마가 호환되는지 확인한다. 첫 버전은 **Actions → Server deployment → Run workflow**에서 `main`을 선택하고 전체 커밋 SHA를 `approved_sha`로 입력해 발행한다. 실행 요약에서 이미지 digest와 `Production tag updated`를 확인한다.

## Lightsail에 설치하기

운영 `.env.prod`가 있는 디렉터리에서 실행한다. 설치 전에 `docker compose ls`에서 현재 프로젝트 이름과 파일 경로를 확인하고, 그 프로젝트에서 `server` 서비스가 정상 실행 중인지 확인한다. 저장소 파일은 준비한 커밋과 맞추고 `.env.prod`는 인스턴스에 보관한다.

```bash
sudo install -d -m 0755 /etc/deskbrawl /usr/local/libexec/deskbrawl
sudo install -m 0755 deploy/deploy-server.sh /usr/local/libexec/deskbrawl/deploy-server.sh
sudo install -m 0644 deploy/deskbrawl-deploy.{service,timer} /etc/systemd/system/
printf 'DESKBRAWL_ROOT=%s\n' "$PWD" | sudo tee /etc/deskbrawl/deploy.env >/dev/null
sudo chmod 0600 /etc/deskbrawl/deploy.env
sudo systemctl daemon-reload
```

기존 Compose를 `-p`로 실행했다면 `/etc/deskbrawl/deploy.env`에 동일한 `COMPOSE_PROJECT_NAME`을 넣는다. 자체 호스팅 환경에서는 같은 파일에 `DESKBRAWL_IMAGE`와 `DESKBRAWL_HEALTH_URL`을 지정한다.

GHCR 패키지가 비공개라면 패키지 읽기 권한이 있는 계정의 `read:packages` 토큰으로 로그인한다. 시스템 서비스와 동일한 Docker 인증을 사용하도록 `sudo`로 실행하고, 토큰을 터미널 히스토리나 저장소에 남기지 않는다.

```bash
read -rp 'GitHub username: ' ghcr_user
read -rsp 'GHCR read token: ' ghcr_token
printf '\n'
printf '%s' "$ghcr_token" | sudo docker login ghcr.io -u "$ghcr_user" --password-stdin
unset ghcr_user ghcr_token
```

첫 수동 적용에서는 현재 실행 중인 서버 이미지를 복구용으로 저장한 뒤 새 이미지를 적용한다. 로그의 `Deployed` digest와 공개 헬스체크를 확인하고 타이머를 활성화한다.

```bash
sudo systemctl start deskbrawl-deploy.service
sudo journalctl -u deskbrawl-deploy.service -n 40 --no-pager
curl -fsS https://api.deskbrawl.xyz/health
sudo systemctl enable --now deskbrawl-deploy.timer
systemctl list-timers deskbrawl-deploy.timer
```

## 마이그레이션이 있는 버전 배포하기

GitHub Actions 요약에 `Production tag held for database review`가 표시되면 현재 승인된 Prisma 파일과 다른 이미지다. `production` 태그가 유지되므로, 다음 코드 변경에도 운영 적용 대기가 이어진다.

1. `sudo systemctl stop deskbrawl-deploy.timer`로 신규 실행을 멈추고 진행 중인 배포가 끝났는지 확인한다.
2. 백업과 복구 절차를 확인한다. DB 변경 후에도 기존 서버가 동작하는지 검증한다. 기존 이미지와 호환되도록 마이그레이션을 나눠 적용하면 자동 롤백을 사용할 수 있다.
3. 승인한 커밋의 소스에서 `sudo docker compose --env-file .env.prod -f compose.prod.yaml run --rm --build --no-deps migrate`를 실행한다. 앞서 `-p`를 사용했다면 이 명령에도 같은 프로젝트 이름을 지정한다. 새 마이그레이션의 적용 결과를 확인한다. [운영 Compose](../compose.prod.yaml)
4. GitHub Actions 수동 실행에 검증한 현재 `main`의 전체 SHA를 입력한다. 태그 갱신을 확인하고 Lightsail에서 `sudo systemctl start deskbrawl-deploy.service`로 반영한다. 공개 헬스체크가 성공하면 `sudo systemctl start deskbrawl-deploy.timer`로 재개한다.

## 배포 오류에서 복구하기

`sudo journalctl -u deskbrawl-deploy.service -n 100 --no-pager`로 실패 원인과 `Restored` 결과를 확인한다. 복구 과정도 실패하면 타이머가 다음 실행에서 복구를 다시 시도한다. 복구에 성공한 뒤에는 같은 실패 digest를 건너뛰고, 수정한 커밋에서 새로운 digest를 발행하면 다시 배포한다.

현재 정상으로 기록된 이미지는 `/var/lib/deskbrawl-deploy/server.env`에 있다. 수동으로 `server`를 재시작할 때에는 이 파일을 추가해 같은 digest를 사용한다.

```bash
sudo docker compose --env-file .env.prod --env-file /var/lib/deskbrawl-deploy/server.env \
  -f compose.prod.yaml up -d --no-deps --no-build --pull never --wait server
```

앞서 `-p`를 사용했다면 수동 실행에서도 같은 프로젝트 이름을 지정한다. DB 변경이 적용된 후에는 이전 이미지와의 호환성을 확인하고 복구한다. 배포 스크립트는 이미지 버전을 복구한다.
