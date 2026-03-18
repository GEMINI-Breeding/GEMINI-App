from sqlmodel import Field, SQLModel


class AppSettingBase(SQLModel):
    key: str = Field(primary_key=True, max_length=255)
    value: str = Field(max_length=4096)


class AppSetting(AppSettingBase, table=True):
    pass


class AppSettingPublic(AppSettingBase):
    pass


class AppSettingUpdate(SQLModel):
    value: str = Field(max_length=4096)
