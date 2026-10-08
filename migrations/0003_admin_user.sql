-- 데모 로그인 계정: 아이디 admin / 비밀번호 demo1234 (로컬에서 써 보는 용도. 실제로 배포할 때는 반드시 바꾼다)
INSERT INTO users (username, name, password_hash) VALUES
  ('admin', '관리자', 'pbkdf2$100000$naFQt2fhrRmZIn/C7roMCw==$wXPk03+jwv+wocj18I+tvQRnP7olLrJPhD+NSJZY/uI=')
ON CONFLICT(username) DO NOTHING;
