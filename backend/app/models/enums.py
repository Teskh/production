from enum import Enum


class WorkUnitStatus(str, Enum):
    PLANNED = "Planned"
    PANELS = "Panels"
    MAGAZINE = "Magazine"
    ASSEMBLY = "Assembly"
    COMPLETED = "Completed"


class PanelUnitStatus(str, Enum):
    PLANNED = "Planned"
    IN_PROGRESS = "InProgress"
    COMPLETED = "Completed"
    CONSUMED = "Consumed"


class StationLineType(str, Enum):
    W = "W"
    M = "M"
    A = "A"
    B = "B"
    C = "C"
    AUX = "AUX"


class StationRole(str, Enum):
    CORE = "core"
    AUXILIARY = "auxiliary"


class TaskScope(str, Enum):
    PANEL = "panel"
    MODULE = "module"


class TaskStatus(str, Enum):
    NOT_STARTED = "NotStarted"
    IN_PROGRESS = "InProgress"
    PAUSED = "Paused"
    COMPLETED = "Completed"
    SKIPPED = "Skipped"


class TaskExceptionType(str, Enum):
    SKIP = "Skip"
    CARRYOVER = "Carryover"


class RestrictionType(str, Enum):
    ALLOWED = "allowed"
    REGULAR_CREW = "regular_crew"


class AdminRole(str, Enum):
    SUPERVISOR = "Supervisor"
    ADMIN = "Admin"
    SYSADMIN = "SysAdmin"
    QC = "QC"


class QCCheckKind(str, Enum):
    TRIGGERED = "triggered"
    MANUAL_TEMPLATE = "manual_template"


class QCTriggerEventType(str, Enum):
    TASK_COMPLETED = "task_completed"
    ENTER_STATION = "enter_station"


class QCCheckOrigin(str, Enum):
    TRIGGERED = "triggered"
    MANUAL = "manual"


class QCCheckStatus(str, Enum):
    OPEN = "Open"
    CLOSED = "Closed"


class QCExecutionOutcome(str, Enum):
    PASS = "Pass"
    FAIL = "Fail"
    WAIVE = "Waive"
    SKIP = "Skip"


class QCReworkStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "InProgress"
    DONE = "Done"
    CANCELED = "Canceled"


class QCNotificationStatus(str, Enum):
    ACTIVE = "Active"
    DISMISSED = "Dismissed"
