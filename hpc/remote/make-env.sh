#!/bin/bash
# Creates run/secrets.env once (random secrets, owner-only). Safe to re-run:
# an existing file is left alone, so the data on disk keeps its passwords.
source "$GEMI_HPC_ROOT/hpc/remote/lib.sh"

F=$RUN/secrets.env
if [ -s "$F" ]; then echo "secrets exist: $F"; exit 0; fi
rand() { python3 -c "import secrets; print(secrets.token_hex(24))"; }
umask 077
cat > "$F" <<EOF
GEMINI_DB_USER=gemini
GEMINI_DB_NAME=gemini
GEMINI_DB_PASSWORD=$(rand)
GEMINI_LOGGER_PASSWORD=$(rand)
GEMINI_STORAGE_ROOT_USER=gemini_root
GEMINI_STORAGE_ROOT_PASSWORD=$(rand)
GEMINI_STORAGE_ACCESS_KEY=gemini_storage_user
GEMINI_STORAGE_SECRET_KEY=$(rand)
GEMINI_STORAGE_BUCKET_NAME=gemini
GEMINI_JWT_SECRET=$(rand)
GEMINI_JWT_ALGORITHM=HS256
GEMINI_JWT_ACCESS_TOKEN_EXPIRE_MINUTES=11520
GEMINI_FIRST_SUPERUSER_EMAIL=${GEMI_SUPERUSER_EMAIL:-$USER@gemini.example.com}
GEMINI_FIRST_SUPERUSER_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(15))")
GEMINI_FIRST_SUPERUSER_FULL_NAME="GEMINI User"
GEMINI_SIGNUP_ENABLED=false
EOF
echo "created $F"
