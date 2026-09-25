import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker


class Base(DeclarativeBase):
    pass


# Одна сессия на запрос; engine привязывается в create_app().
db = scoped_session(sessionmaker(expire_on_commit=False))


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_db_url(url: str) -> str:
    # Render/Railway/Heroku отдают postgres:// — SQLAlchemy нужен явный драйвер.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def init_engine(url: str):
    url = normalize_db_url(url)
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if url in ("sqlite://", "sqlite:///:memory:"):
            from sqlalchemy.pool import StaticPool
            kwargs["poolclass"] = StaticPool
        else:
            path = url.split("sqlite:///", 1)[-1]
            if os.path.dirname(path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _):
            dbapi_conn.execute("PRAGMA foreign_keys=ON")
    db.remove()
    db.configure(bind=engine)
    return engine
