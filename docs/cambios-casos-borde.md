# Registro de cambios: situaciones que dejaban trabajo trabado

Este cambio corrige situaciones en que algo quedaba **trabado, invisible o mal registrado** sin que nadie se enterara. También agrega **avisos antes de acciones con consecuencias ocultas**.

---

## Control de calidad (QC)

### Retrabajos
- **Retrabajos de paneles que ya salieron de la línea.** Si una inspección fallaba cuando el panel ya había terminado su recorrido, el retrabajo no aparecía en ninguna estación. Ahora aparece en la estación donde está el módulo (Magazine o Ensamble), marcado como **"Panel fuera de línea"**.
- **Cancelar un retrabajo.** QC ahora puede cancelar un retrabajo desde su panel. Debe indicar **el motivo**, y queda registrado **quién lo canceló y cuándo**. La inspección fallida sigue en el historial.
- **Terminar un retrabajo desde el aviso "tarea activa en otra estación"** ahora lo cierra correctamente, y la inspección queda lista para revisarse de nuevo.
- Un retrabajo **cancelado por QC** ya no puede marcarse como terminado por un trabajador.

### Marcar módulo terminado
- Antes de terminar un módulo, el sistema ahora **avisa cuántas inspecciones, retrabajos y tareas siguen abiertos**, y pide confirmación.
- Al confirmar:
  - las inspecciones abiertas se cierran y quedan como **no realizadas**;
  - los retrabajos abiertos se **cancelan**;
  - las tareas sin terminar se cierran como **omitidas**, no como terminadas, y **se conserva el tiempo ya trabajado**.

### Panel de QC
- Las inspecciones de paneles **ya no desaparecen** cuando el módulo pasa a Ensamble. Siguen en la lista con la etiqueta **"Módulo ya en ensamble"**.
- Nuevo aviso cuando una inspección **depende de tareas archivadas o inactivas** y por lo tanto ya no se va a activar.

### Frecuencia de inspección (muestreo)
- Después de una inspección fallida, la revisión pasaba a hacerse en el 100 % de los casos y **quedaba así para siempre**, aunque se cambiara la configuración. Ahora:
  - el aumento automático solo aplica si el **ajuste automático** está activado;
  - al cambiar la frecuencia base o el ajuste automático, se vuelve a la frecuencia base;
  - se muestra la **frecuencia real vigente**, con un botón **"Restablecer a tasa base"**.

### Tipos y subtipos de casa
- Al eliminar un tipo o subtipo de casa, las inspecciones que solo aplicaban a él **ya no pasan a aplicarse a todas las casas**: quedan **desactivadas**, y el aviso de eliminación dice cuántas.
- Al **reactivar** una inspección que no tiene reglas de aplicación, el sistema avisa que se aplicará a **todas las casas y módulos** y pide confirmación.

### Observaciones (reclamos de calidad)
- QC ahora puede **reasignar supervisores** de una observación.
- Si se reasigna, la propuesta de cierre pendiente del supervisor anterior **se descarta**, y los nuevos supervisores deben revisarla.
- QC puede **cerrar una observación por su cuenta** indicando un motivo. Se conserva todo el historial y las fotos, y queda registrado como **"Cierre forzado por QC"**, distinto de un cierre aceptado.
- Etiqueta **"Sin supervisor"** en las observaciones que quedaron sin responsable.

---

## Configuración de tareas y estaciones

### Archivar o desactivar una tarea
Antes de archivar o desactivar una tarea, el sistema muestra:
- las **inspecciones de QC** que esa tarea activa;
- las **tareas que dependen de ella**;
- las **estaciones de ensamble** que se quedarían sin una tarea que haga avanzar los módulos;
- que los paneles detenidos solo por esa tarea **avanzarán automáticamente**.

### Dependencias entre tareas
- Ya no se puede guardar una dependencia de **una tarea consigo misma**, que apunte a una **tarea inexistente o archivada**, ni que forme un **círculo** (A depende de B y B de A). El mensaje indica qué tareas forman el círculo.
- El selector de dependencias ya no ofrece opciones que crearían un círculo.
- Una tarea que ya dependía de otra que luego se archivó **se puede seguir editando** normalmente.

### Estaciones sin tarea de avance
- Nuevo aviso en Tareas y en Estaciones cuando una estación de ensamble **no tiene una tarea que haga avanzar** los módulos para algún tipo de casa o número de módulo (incluye casas sin subtipo).

### Desactivar un tipo de condición
- Antes de desactivarlo, el sistema muestra **qué tareas cambian** y **cuántos módulos en producción se ven afectados**, y pide confirmación.

### Editar o eliminar estaciones
- No se puede cambiar el rol, la línea o el número de una estación **mientras tenga paneles o módulos** (incluye los módulos en Magazine).
- No se permiten **dos estaciones con el mismo número** en la misma línea y rol.
- Se avisa si un cambio deja **tareas sin estación**, o si ya no quedaría una estación de paneles **número 1**.
- Eliminar una estación ahora **pide confirmación**.

---

## Trabajo en estaciones

### Inicio de tareas
- Si dos tablets intentan iniciar el mismo panel, el sistema ya **no crea un panel duplicado**: usa el que ya existe.
- **Dependencias:** una tarea ya no queda bloqueada para siempre cuando la tarea previa fue **omitida**, **no aplica** a ese panel o módulo, o fue **archivada o desactivada**.
- Si la tarea previa archivada **todavía está en curso**, hay que terminarla primero.

### Pausas
- Pausar una tarea que **ya estaba pausada** (doble toque o dos tablets) ya no crea una segunda pausa. Antes, el tiempo trabajado quedaba subestimado.
- Al reanudar, se cierran **todas** las pausas abiertas. Esto aplica también a los retrabajos.

### Omitir una tarea
- Omitir una tarea que **ya estaba en curso** ahora la cierra correctamente. Antes quedaba pausada para siempre.

### Salir de una tarea
- Nuevo botón **"Salir de la tarea"**. Si sale el último trabajador, la tarea **se pausa sola**.
- Al **desactivar a un trabajador**, el sistema muestra sus tareas abiertas y lo **retira de ellas**. Las tareas que quedan sin nadie se pausan.

### Avance de paneles
- Terminar tarde una tarea de una estación anterior ya **no devuelve un panel** a una estación anterior, ni reabre un panel ya terminado.
- Una tarea olvidada en **otra estación** ya no impide que un panel avance.

---

## Planificación (Secuencia de producción)

- Nueva sección **"Liberaciones automáticas recientes"**: muestra cada panel que el sistema hizo avanzar solo tras un cambio de configuración (qué panel, desde dónde, hacia dónde y por qué).
- Botón **"Deshacer"** para devolver el panel (y el estado del módulo) a donde estaba, siempre que **no haya pasado nada con él desde entonces**.
- Importante: deshacer no corrige la configuración. Si el error de configuración sigue, el panel puede volver a avanzar con el siguiente cambio.

---

## Costos

- El **tiempo trabajado** en tareas que se cerraron sin terminar (omitidas, retrabajos cancelados o módulos marcados como terminados) **ahora sí cuenta** en los costos del proyecto.

---

## Acciones al mismo tiempo

Se evitan errores cuando dos personas actúan **en el mismo instante**:
- QC termina un módulo mientras otro inspector registra una falla;
- un trabajador termina un retrabajo mientras QC lo cancela;
- se deshace una liberación mientras un trabajador inicia una tarea en ese panel;
- dos trabajadores salen de la misma tarea a la vez.

---

## Sin cambios (decisión intencional)

- Los paneles nuevos **solo comienzan en la estación de paneles número 1**.
- Al cambiar la frecuencia de inspección se pierde el aumento que había dejado una falla reciente.
- Las tareas de un trabajador desactivado quedan pausadas hasta que alguien las retome.

---

**Para instalar:** este cambio necesita una actualización de la base de datos antes de usarse.
