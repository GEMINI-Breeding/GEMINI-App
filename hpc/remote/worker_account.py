"""Create or update the workers' account (run by core.sbatch inside the rest-api image).

Workers sign in to the API with GEMINI_FIRST_SUPERUSER_EMAIL / _PASSWORD from
run/stack.env. On a cluster those are this account's, not the owner's: a
superuser named GEMI_WORKER_EMAIL whose password is new at every core start
(GEMI_WORKER_PASSWORD). It can do what workers do, but holding it gives no
lasting access: the next core start changes the password.
"""
import os
import sys

from gemini.api.user import User

email = os.environ["GEMI_WORKER_EMAIL"]
password = os.environ["GEMI_WORKER_PASSWORD"]
user = User.get(email=email)
if user is None:
    user = User.create(email=email, password=password, full_name="GEMI workers",
                       is_active=True, is_superuser=True, user_info={"service": "workers"})
    print("created", email if user else "FAILED")
else:
    user = user.update(password=password, is_active=True, is_superuser=True)
    print("updated", email if user else "FAILED")
sys.exit(0 if user else 1)
