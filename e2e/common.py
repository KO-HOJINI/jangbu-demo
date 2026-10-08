"""
e2e 점검 스크립트가 함께 쓰는 설정.

  BASE             대상 주소 (기본: 로컬 개발 서버 http://localhost:5173)
  JANGBU_USERNAME  아이디 (기본: admin)
  JANGBU_PASSWORD  비밀번호 — 반드시 환경변수로. 저장소에는 비밀번호를 적지 않는다.
  ALLOW_LIVE=1     로컬 전용 스크립트를 굳이 실서버에 돌릴 때 (임시 명세표를 만들었다 지운다)
"""
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

BASE = os.environ.get('BASE', 'http://localhost:5173').rstrip('/')
USERNAME = os.environ.get('JANGBU_USERNAME', 'admin')
PASSWORD = os.environ.get('JANGBU_PASSWORD')
if not PASSWORD:
    sys.exit('JANGBU_PASSWORD 환경변수로 비밀번호를 넣어 주세요. (저장소에는 비밀번호를 적지 않는다)')

# 스크린샷·PDF 같은 결과물. 장부 내용이 찍히므로 .gitignore 로 저장소에서 뺀다.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)


def local_only(what: str) -> None:
    """실서버 자료를 만들었다 지우는 점검은 로컬에서만 돌게 막는다."""
    if BASE.startswith('http://localhost') or os.environ.get('ALLOW_LIVE') == '1':
        return
    sys.exit(f'{what}: 임시 명세표 같은 자료를 만들었다 지우므로 로컬 개발 서버에서만 돌린다. ({BASE})')
