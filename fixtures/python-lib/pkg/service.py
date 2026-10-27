from pkg.repo import get_user

note = "import os should not count"

def run_service(user_id):
    return get_user(user_id)
