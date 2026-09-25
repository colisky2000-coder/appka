"""
Точка входа для Passenger (виртуальный хостинг Sprinthost и похожие).
Passenger ищет в этом файле объект application. Настройки берутся из файла .env рядом.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Если Passenger запустил системный Python, перезапускаемся из виртуального окружения
# (../venv — рядом с public_html, как советует Sprinthost, или ./venv)
for venv in (os.path.join(HERE, "..", "venv"), os.path.join(HERE, "venv")):
    python = os.path.join(venv, "bin", "python3")
    if os.path.exists(python):
        if os.path.realpath(sys.prefix) != os.path.realpath(venv):
            os.execl(python, python, *sys.argv)
        break

sys.path.insert(0, HERE)
from wsgi import app as application  # noqa: E402,F401
