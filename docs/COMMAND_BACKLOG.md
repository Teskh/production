[X] task already started, default focus in workspace
if a worker logs into a station with multiple modules / panels, and one of them has a task already on going for him/her, it should auto focus that task

[X] first name and last name only
If a worker logs in who has multiple first names and last names added display only one first name and one last name (e.g. Juan Carlos Urreta Lopez should be Juan Urreta)

[X] Remove the "Change station"
Remove the "Change station" button feature altogether. if he wants to change station he has to log out

[X] Station context
Station context should be stored per device. We want to be able to set station groups in the context (which should be saved)
These groups include: Panel line (when this is set, before even showing the login screen the user must choose from a list of only the panel stations). Choosing one logs the user into the specific station, but doesn't overwrite the station context saved preference, which stays as "Panel line" such that upon log out the next user is asked to choose specific station.
Similar groups exist for each of the assembly lines, where each of the assembly stations of the same sequence_order are shown and the user is asked to adjust which one he picks 

[X] produce the migrations necessary to get our schema from what it currently is to that agreed upon herein

[ ] remove header from layouts
Let's make some adjust a few things about our layouts in general: move the headers of the pages specifically into the master header defined in @ui/src/layouts/AdminLayout.tsx (e.g. Task Definition Studio in @ui/src/pages/admin/config/TaskDefs.tsx would be where Operations Control now is.)
Get rid of "Operations control" and its surronding text as well as icon. Also remove the subtitles (like "Build task templates, dependencies, and crew constraints.")

[ ] Workspace 
ui/src/pages/worker/StationWorkspace.tsx isn't quite up to the standard we need yet, per docs/REBUILD_ALT_MODEL.md docs/PRODUCTION_MANAGER.md docs/PRODUCTION_RULES.md. We're not blocking task start for tasks which have unfinished task dependencies. Neither are we doing so for tasks uniquely permitted to one worker only

[ ] Translation I:
This project is ultimately meant to be wholly in Spanish in all its user facing interface. This is a large task for which we will need a few turns. To beign with let's create a docs/APP_TRANSLATION_CHECKLSIT.md where we're gonna make a [ ] List of all the files we need to go through and mark [X] The ones we're done with, along with concise instructions about the translation job we're carrying for future agents that might continue it.
Terms that should be kept in English:
- Framing Station is meant to stay the same.
- Multiwalls (type of wall) stays in English


[ ] QC execution page
Let's double click on @ui/src/pages/qc/QCExecution.tsx. these executions will be performed on a vertical/horizontal tablet. Its very important that our lay out look really good under those conditions. This page in particualr can mostly lack header UI elements (we can keep a minimal back button and nothing else). It should display a carousel of images for the references and guidance images (two image carousels sharing half the screens width roughly). The description should be placed smartly so as to be grouped with the buttons inteliigently. Do whatever shuffling around necessary to end up with a better, cleaner layout per these instructions. (I believe you have to ensure that it's not within the QC layout format too)