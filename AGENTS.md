This project is an attempt at a large scale refactor of another project.
it features a ui/ folder with a frontend setup, which features mostly placeholders. it was built off docs/REBUILD_UI_SPEC.md by someone without any view of the backend or deeper understanding about how the project would eventually work, thus treat only the style as a guide, but otherwise don't be coy about largely rebuilding pages as much as necessary.
Deeper guides about the functioning of the project is found in docs/
docs/ROADMAP.md is a checklist style roadmap of where we are in the rebuilding of the refactor

Whenever big assumptions have to be made, outside the scope of docs/, leave the assumption in docs/ASSUMPTIONS_MADE.md to keep a clean registry.

always use 'uv' instead of 'pip' for python dependencies. We already have a root level uv virtual environment (venv)