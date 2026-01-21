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
    LINE_1 = "1"
    LINE_2 = "2"
    LINE_3 = "3"


class StationRole(str, Enum):
    PANELS = "Panels"
    MAGAZINE = "Magazine"
    ASSEMBLY = "Assembly"
    AUX = "AUX"


class TaskScope(str, Enum):
    PANEL = "panel"
    MODULE = "module"
    AUX = "aux"


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


class QCReworkStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "InProgress"
    DONE = "Done"
    CANCELED = "Canceled"


class QCNotificationStatus(str, Enum):
    ACTIVE = "Active"
    DISMISSED = "Dismissed"


class QCSeverityLevel(str, Enum):
    BAJA = "baja"
    MEDIA = "media"
    CRITICA = "critica"


class QCCheckMediaType(str, Enum):
    GUIDANCE = "guidance"
    REFERENCE = "reference"
