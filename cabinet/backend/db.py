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


def auto_migrate(engine):
    """
    Добавляет в существующие таблицы колонки, появившиеся в моделях.
    Простая замена миграциям: только добавление, без переименований и удалений.
    """
    from sqlalchemy import inspect, literal, text

    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(engine.dialect)}'
                default = col.default.arg if col.default is not None and col.default.is_scalar else None
                if default is not None:
                    lit = literal(default, type_=col.type).compile(dialect=engine.dialect, compile_kwargs={"literal_binds": True})
                    ddl += f" NOT NULL DEFAULT {lit}"
                conn.execute(text(ddl))


# Таблицы удалённых разделов: при запуске стираются вместе с данными
OBSOLETE_TABLES = ("traffic_rows", "purchases")


def drop_obsolete(engine):
    from sqlalchemy import inspect, text

    have = set(inspect(engine).get_table_names())
    with engine.begin() as conn:
        for name in OBSOLETE_TABLES:
            if name in have:
                conn.execute(text(f'DROP TABLE "{name}"'))


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
