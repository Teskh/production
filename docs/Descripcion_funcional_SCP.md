# SCP: descripción completa y sencilla de la aplicación

Este documento explica cómo funciona SCP desde el punto de vista de las personas que la usan. Está escrito para alguien que no necesita saber de informática. Por eso se habla de casas, módulos, paneles, estaciones, tareas, controles y responsables. No se explica cómo está construida la aplicación por dentro.

La descripción se basa en la versión del proyecto revisada el 2 de septiembre de 2026. Los nombres de algunos botones pueden cambiar según el perfil de la persona, los permisos que tenga y la información disponible en la instalación.

## Qué es SCP

SCP es una aplicación para organizar y seguir la fabricación de casas modulares. Permite preparar la forma en que se fabrica cada modelo, ordenar los módulos que deben producirse, indicar qué tareas corresponden a cada estación, registrar el trabajo de los operadores y controlar la calidad.

La aplicación reúne en un mismo lugar cuatro tipos de trabajo:

- La planificación de la producción.
- La ejecución de tareas en la planta.
- El control de calidad y el retrabajo.
- La consulta de resultados, asistencia y rendimiento.

Una persona puede usar SCP como operador en una estación, como supervisor de la planta, como responsable de calidad o como administrador. Cada perfil ve las herramientas que necesita. Un administrador principal puede decidir qué páginas puede ver o modificar cada grupo de usuarios.

La idea general es la siguiente:

1. Se define cómo es cada tipo de casa.
2. Se define qué paneles lleva cada módulo y en qué orden se trabajan.
3. Se definen las tareas, las estaciones, los tiempos esperados y las condiciones que hacen que una tarea corresponda o no.
4. Se crea un lote de producción.
5. Los operadores trabajan cada panel y cada módulo desde su estación.
6. Al terminar tareas importantes pueden abrirse controles de calidad.
7. Si un control falla, se crea un retrabajo y se avisa a las personas que deben resolverlo.
8. Los informes muestran qué se produjo, cuánto tiempo tomó, dónde hubo pausas, quién participó y cómo se comportó la asistencia.

## Palabras básicas para entender la aplicación

### Proyecto

Es el nombre general de una obra o pedido. Un proyecto puede tener una o muchas casas.

### Casa

Es una unidad de vivienda identificada por un nombre o número, por ejemplo, Casa SV-01. Cada casa pertenece a un tipo de casa y puede tener un subtipo.

### Tipo de casa

Es el modelo general de una casa. Indica, entre otras cosas, cuántos módulos tiene. Dos casas del mismo tipo comparten la misma estructura de módulos.

### Subtipo

Es una variante de un tipo de casa. Puede cambiar los paneles o los valores de ciertos parámetros. Se puede usar, por ejemplo, para distinguir una versión con una distribución o terminación diferente.

### Módulo

Es una parte de la casa que se fabrica y se sigue por separado. La aplicación identifica cada módulo con un número, como Módulo 1 o Módulo 2.

### Panel

Es una pieza que pertenece a un módulo. Cada panel tiene un código, un grupo y, opcionalmente, una superficie y un largo. Un módulo puede tener paneles de piso, cielo, perímetro, tabiques interiores, vigas cajón, multiwalls u otros grupos.

### Estación

Es un lugar de trabajo. Puede ser una estación de paneles, una estación de apoyo o una estación de armado y terminaciones. Las estaciones de armado están ordenadas dentro de una línea de producción.

### Línea

Es el recorrido que sigue un módulo por las estaciones de armado. La aplicación puede manejar las líneas 1, 2 y 3. Una línea puede tener varias estaciones ordenadas.

### Tarea

Es una actividad que una persona debe iniciar, pausar y terminar. Una tarea puede corresponder a un panel, a un módulo completo o a una actividad auxiliar.

### Cuadrilla

Es el grupo de personas que participa en una tarea. Una tarea puede tener una persona o varias. La aplicación permite guardar una cuadrilla habitual como ayuda para seleccionarla rápidamente.

### Condición

Es una característica que tiene un módulo, como un tipo de piso, un nivel de terminación o un paquete opcional. Las condiciones determinan qué tareas aplican a ese módulo.

### Control de calidad

Es una revisión de un panel, un módulo o una actividad. El responsable de calidad puede aprobarla o marcarla como fallida. También puede adjuntar fotos, videos, notas y modos de falla.

### Observación

Es una conversación sobre un problema o hallazgo de la planta. Tiene un título, una descripción, una severidad, responsables y un historial de comentarios.

### Retrabajo

Es el trabajo adicional necesario para corregir algo que no cumplió un control de calidad. El retrabajo aparece en la estación correspondiente y se puede trabajar como una tarea.

## El recorrido completo de una orden

### Primero se prepara el producto

Antes de producir, una persona autorizada crea los tipos de casa, sus subtipos, sus módulos y sus paneles. También indica el orden de los paneles dentro de cada módulo.

Después se crean las tareas. Cada tarea puede decir:

- Si corresponde a un panel, a un módulo o a una actividad auxiliar.
- En qué estación se realiza.
- Cuántos minutos se esperan.
- Cuántas personas se esperan.
- Qué especialidad se necesita.
- Qué otras tareas deben terminar antes.
- Si se permite trabajar en paralelo con otra tarea.
- Si un panel puede omitirla.
- Si terminarla debe mover el módulo a la siguiente estación.
- Qué personas están autorizadas para realizarla.
- Qué condiciones hacen que aplique.

### Luego se crea la producción

En la cola de producción se registra el proyecto, la base del identificador de las casas, el tipo de casa, la cantidad, el subtipo si corresponde y la fecha y hora planificadas.

Si se solicita una cantidad de tres casas y cada casa tiene cuatro módulos, SCP crea doce módulos para esa orden. Cada módulo conserva el nombre del proyecto, el identificador de la casa, el número de módulo, el tipo de casa, el subtipo y sus condiciones.

### El módulo comienza como planificado

Un módulo recién creado está en estado Planificado. Todavía no ha comenzado el trabajo de paneles ni el trabajo de armado.

Los módulos activos aparecen en la cola. La cola se puede reordenar para indicar cuál debería atenderse primero. También se puede cambiar la línea de armado y, mientras el módulo esté planificado, cambiar el tipo de casa o el subtipo si la estructura sigue siendo compatible.

### Los paneles pasan por las estaciones de paneles

Cuando un operador inicia el primer trabajo de panel de un módulo, el módulo pasa a Paneles. El panel queda ubicado en la estación donde se inició.

Al terminar todas las tareas necesarias para ese panel en una estación, la aplicación busca la siguiente estación de paneles que tenga tareas para ese panel. Si la encuentra, mueve el panel allí. Si no encuentra otra, marca el panel como terminado.

Cuando todos los paneles que corresponden al módulo están terminados, el módulo pasa a Magazine. Magazine es la zona intermedia entre la fabricación de paneles y el armado del módulo.

### El módulo pasa a armado y terminaciones

Cuando se inicia una tarea de módulo en una estación de armado, el módulo pasa a Armado. Si todavía no tenía una línea elegida, se registra la línea de esa estación.

Cuando se termina una tarea marcada como tarea que impulsa el avance, la aplicación busca la siguiente estación de la misma línea que tenga tareas aplicables para ese módulo. Si la encuentra, mueve el módulo allí.

Si no hay otra estación con tareas aplicables, el módulo permanece en la última estación de armado. Esto permite que calidad o una persona con permisos cierre el módulo cuando las revisiones finales estén listas.

### Los controles de calidad pueden aparecer durante el recorrido

Una tarea puede estar relacionada con un control de calidad. Al terminar esa tarea, SCP puede abrir automáticamente una revisión. La revisión queda asociada al módulo, al panel, a la estación y a la tarea que la generó.

También es posible abrir una revisión manual. Esto sirve cuando alguien quiere revisar algo fuera del momento automático, repetir una revisión o registrar una verificación especial.

### El módulo termina

Un módulo puede terminar de dos maneras:

- La aplicación lo deja listo después de que el recorrido de tareas, paneles y revisiones permite cerrarlo.
- Una persona autorizada lo marca como completado desde calidad o desde una pantalla de administración.

Al marcarlo como completado, los paneles quedan como consumidos para indicar que forman parte del módulo terminado. Esta acción no borra el historial del trabajo.

## Estados que se ven en la aplicación

### Estados del módulo

| Estado | Qué significa |
| --- | --- |
| Planificado | El módulo fue creado, pero todavía no comenzó su trabajo. |
| Paneles | Hay paneles del módulo en fabricación o en alguna estación de paneles. |
| Magazine | Los paneles aplicables ya terminaron y el módulo espera o se prepara para armado. |
| Armado | El módulo está recorriendo una línea de armado y terminaciones. En algunas pantallas este estado aparece como Terminaciones o Assembly. |
| Completado | El módulo se cerró como terminado. |

### Estados del panel

| Estado | Qué significa |
| --- | --- |
| Planificado | El panel está definido, pero todavía no se ha comenzado. |
| En progreso | El panel está siendo atendido en una estación. |
| Completado | Ya pasó por todas sus estaciones de paneles. |
| Consumido | El panel pertenece a un módulo que ya fue cerrado. |

### Estados de una tarea

| Estado | Qué significa |
| --- | --- |
| Sin iniciar | La tarea aparece disponible, pero nadie la ha comenzado. |
| En trabajo | Una o más personas están trabajando en ella. |
| En pausa | El trabajo se detuvo y tiene una razón registrada. |
| Completada | La tarea terminó y las personas participantes salieron de ella. |
| Omitida | La tarea se registró como no realizada porque estaba permitido omitirla y se dejó una razón. |

### Estados de un control de calidad

| Estado | Qué significa |
| --- | --- |
| Abierto | La revisión todavía no tiene un resultado final. |
| Cerrado | La revisión ya tiene un resultado. Puede haber sido aprobada o fallida con un retrabajo asociado. |

### Estados de un retrabajo

| Estado | Qué significa |
| --- | --- |
| Abierto | El problema fue registrado y todavía nadie lo ha resuelto. |
| En progreso | Una persona está trabajando en la corrección. |
| Finalizado | La corrección terminó y se puede volver a revisar. |
| Cancelado | Una persona autorizada canceló ese retrabajo. |

## Cómo se entra a la aplicación

### Acceso desde la planta

En la red interna de la planta, la aplicación abre directamente la pantalla de ingreso. Fuera de la red autorizada, primero pide una cuenta de Microsoft de la organización. Esto permite distinguir a las personas de la empresa de quienes no tienen acceso.

Una cuenta de Microsoft de la empresa no crea automáticamente un usuario con permisos. Para entrar a administración, esa dirección de correo debe estar asociada a una cuenta activa dentro de SCP. Si no existe esa asociación, la persona puede pasar el control de acceso de la empresa, pero no recibe un menú de administración.

### Ingreso de un operador

El operador no necesita entrar con una cuenta de correo. En la pantalla inicial:

1. Se elige la estación o el grupo de estaciones.
2. Se elige el nombre de la persona.
3. Si la persona tiene un PIN obligatorio, se ingresa el PIN.
4. Se entra al espacio de trabajo de la estación.

Al principio se muestran las personas asignadas a la estación elegida. También existe la opción No estás en tu estación? Inicia sesión, que permite buscar entre todas las personas activas.

La búsqueda acepta nombres con o sin tildes y no exige escribir el nombre exactamente igual. Si hay más de veinte personas, la aplicación cambia a una lista con búsqueda para que la selección sea más rápida.

### Ingreso con código QR

Se puede activar el escaneo continuo de códigos QR desde Ajustes. El código puede estar impreso en la credencial de la persona.

Cuando la cámara reconoce un código que coincide con una persona activa, SCP selecciona a esa persona y realiza el ingreso correspondiente. Si el dispositivo no tiene cámara compatible, la aplicación muestra un aviso y se puede seguir usando la selección manual.

El escaneo recuerda si quedó activado en ese dispositivo. Por eso un equipo de planta puede quedar preparado para el ingreso rápido, mientras que otro equipo puede mantenerlo apagado.

### PIN inicial y cambio de PIN

Una persona que todavía usa el PIN inicial puede ser obligada a crear uno nuevo. El nuevo PIN debe tener al menos cuatro caracteres y debe repetirse para confirmar que no hubo un error.

Los administradores también pueden decidir si una persona debe usar PIN o si puede entrar después de seleccionar su nombre. Esta opción se configura en Personal.

### Ingreso de administración

Desde Ajustes se abre Menú Admin. La persona puede entrar con nombre, apellido y PIN. También existe un acceso con Microsoft para los administradores que tengan una dirección de correo asociada.

La cuenta principal protegida se puede usar mediante la opción de administrador principal. Esa opción está pensada para tareas de máxima responsabilidad, como permisos, copias de seguridad y configuración protegida.

### Ingreso de calidad

Desde Ajustes se puede abrir Calidad. El menú general de calidad permite consultar parte de la información sin identificarse, pero crear y ejecutar revisiones requiere una sesión de calidad.

### Sesión de supervisor

El espacio de protocolos tiene una sesión separada para el supervisor. Sirve para firmar protocolos que le correspondan, comentar observaciones y proponer el cierre de una observación. No reemplaza el ingreso administrativo.

### Sesiones y salida

El operador puede cerrar su sesión. Al hacerlo, el nombre deja de estar activo en la estación y la pantalla vuelve al ingreso.

Si una sesión permanece sin actividad durante el tiempo configurado, puede vencer. La aplicación también revoca la sesión cuando se cierra desde el botón de salida. El administrador y el supervisor tienen sus propios botones de salida.

## Ajustes del puesto de trabajo

La ventana Ajustes reúne accesos y decisiones que afectan al dispositivo:

- Calidad.
- Menú Admin.
- Vista de supervisor.
- Estado de planta.
- Protocolos de seguridad.
- Pantalla completa.
- Escaneo QR.
- Grupo de estaciones.
- Estación específica.

### Elegir un grupo de estaciones

El operador puede elegir:

- Línea de paneles.
- Una secuencia de armado y terminaciones.
- Auxiliar.

Si elige una secuencia de armado, puede seleccionar el grupo que representa esa posición del recorrido. Así, el mismo equipo puede trabajar con cualquiera de las estaciones que pertenezcan a esa secuencia.

### Elegir una estación específica

También se puede elegir una estación concreta de paneles o de armado. Esta modalidad es útil cuando el dispositivo está instalado en un lugar fijo.

### Protección contra cambios de estación

Por defecto, cambiar de estación o cambiar de grupo en un dispositivo de planta pide confirmación de un administrador mediante nombre y PIN. La autorización dura un tiempo corto, de modo que se pueden hacer varios ajustes seguidos sin repetir el ingreso en cada clic.

La protección se puede desactivar desde la configuración de estaciones cuando el equipo está en una situación controlada o en una etapa de preparación. En la operación normal conviene mantenerla activa para evitar que una persona trabaje por error con la estación equivocada.

Si el equipo está configurado para un grupo y pasa un período de inactividad, puede volver a mostrar el selector de estación antes de continuar.

### Pantalla completa y uso táctil

En equipos táctiles, tocar dos veces un espacio vacío puede solicitar la pantalla completa. También existe un botón para entrar o salir de ese modo.

La pantalla completa está pensada para tablets instaladas en la planta. Los botones y las tarjetas se pueden usar con el dedo. La aplicación evita interpretar como doble toque los toques sobre botones, campos, enlaces o listas.

## El espacio de trabajo del operador

### Qué aparece al entrar

El operador ve:

- La estación o el grupo activo.
- La persona que inició sesión.
- Los módulos o paneles disponibles.
- Las tareas de la estación.
- Las tareas de otras estaciones que sean visibles.
- Las tareas atrasadas de estaciones anteriores.
- Las pausas y notas que pueden registrarse.
- Los retrabajos de calidad que correspondan.

La pantalla se actualiza para reflejar cambios hechos por otras personas. Por ejemplo, si otro operador termina una tarea, esa tarea deja de aparecer como disponible.

### Cómo se elige el trabajo

En una estación de paneles, la aplicación presenta primero:

- El siguiente panel planificado.
- Los paneles que ya están en progreso.
- Los siguientes paneles de la cola, con un límite visible para que la pantalla siga siendo manejable.
- Otros elementos que puedan ser atendidos.

El primer panel planificado aparece destacado como recomendado. Esto orienta el orden de trabajo, pero no reemplaza la revisión de la situación real de la planta.

En Magazine se muestran módulos cuyos paneles ya están listos para pasar a armado. En una estación de armado se muestran los módulos que están ubicados en esa estación.

Si un módulo que está en Magazine tiene una primera estación de armado aplicable, la aplicación puede ofrecerlo para su admisión en esa estación.

### Información de cada elemento

Una tarjeta de trabajo puede mostrar:

- Proyecto.
- Identificador de la casa.
- Número de módulo.
- Tipo y subtipo de casa.
- Código del panel.
- Grupo del panel.
- Condiciones del módulo.
- Estado del elemento.
- Estación actual.
- Tareas terminadas y pendientes.

Las condiciones aparecen como etiquetas para que el operador entienda por qué algunas tareas están presentes y otras no.

### Cómo se ordenan las tareas

Cada tarjeta separa las tareas en tres grupos:

- Tareas de la estación actual.
- Otras tareas que aplican, pero no tienen una estación concreta o pertenecen a otro punto del recorrido.
- Tareas atrasadas de estaciones anteriores.

Las tareas terminadas quedan debajo o dejan de mostrarse según el grupo. Las tareas frecuentes pueden aparecer destacadas. Una tarea se considera frecuente cuando se ha terminado al menos tres veces durante los últimos siete días.

## Trabajar una tarea paso a paso

### Iniciar

Al pulsar Iniciar, la aplicación comprueba:

- Que la tarea siga activa.
- Que corresponda al tipo de elemento elegido.
- Que la persona esté en la estación correcta.
- Que el panel o el módulo corresponda a esa tarea.
- Que las dependencias ya estén completas.
- Que la persona esté autorizada si la tarea tiene una lista restringida.
- Que la persona no esté ocupada en otra tarea que no permite trabajo simultáneo.

Si todo está correcto, la tarea queda En trabajo y comienza a contar el tiempo.

Si es el primer trabajo de un panel, el panel pasa de Planificado a En progreso. Si es el primer trabajo de módulo en armado, el módulo pasa a Armado.

### Unirse

Si otra persona ya inició una tarea y la tarea admite varias personas, aparece Unirse. Al usarlo, la persona queda registrada como participante de la misma tarea.

Unirse no crea una segunda tarea. Todos los participantes trabajan sobre el mismo registro y la tarea termina cuando la persona que corresponde la completa.

### Elegir el equipo

El botón Equipo permite elegir varias personas para comenzar juntas una tarea. La lista agrupa:

- La cuadrilla habitual.
- Las personas asignadas a la estación.
- Otras personas disponibles.
- La persona que está usando el equipo.

Las personas que ya están ocupadas en otra tarea no simultánea aparecen deshabilitadas. Una cuadrilla habitual ayuda a elegir más rápido, pero no obliga a que esas mismas personas participen.

### Pausar

Pausar detiene el tiempo activo de la tarea y cambia su estado a En pausa. La aplicación pide una razón de pausa. La razón puede ser una opción predefinida para esa estación o un texto escrito por la persona.

La razón queda guardada junto con la hora de inicio y la hora de término de la pausa. Si la tarea vuelve a pausarse, se crea otro tramo de pausa. Los informes pueden sumar las pausas y separarlas por motivo.

### Reanudar

Reanudar vuelve a poner la tarea En trabajo y cierra el tramo de pausa abierto. La persona que reanuda debe estar permitida para esa tarea y no tener un conflicto con otra tarea que no admite trabajo simultáneo.

### Terminar

Terminar cierra la tarea. Si la persona escribe una nota al terminar, la nota se agrega al historial de la tarea.

Al terminar, SCP:

- Registra la hora de término.
- Saca de la tarea a todas las personas que seguían participando.
- Cierra cualquier pausa que hubiera quedado abierta.
- Comprueba si el panel puede avanzar.
- Comprueba si el módulo debe pasar a otra estación.
- Abre los controles de calidad que se disparen con esa tarea.
- Registra la estación en la que se completó la tarea para los informes de adherencia.

### Terminar y avanzar

En algunas tareas de módulo aparece Terminar y avanzar. Es una confirmación especial para las tareas que marcan el movimiento del módulo.

La aplicación muestra una confirmación breve antes de moverlo. Si se confirma, busca la siguiente estación aplicable dentro de la misma línea. Si no existe, deja el módulo en la estación final.

### Omitir

Solo las tareas de panel que fueron configuradas como omitibles pueden omitirse. La persona debe indicar una razón.

Omitir no borra la tarea ni finge que se trabajó. Deja una excepción visible como Omitida y permite que el panel avance si todas las demás tareas necesarias están completas u omitidas.

Las tareas de módulo no se pueden omitir desde el flujo normal del operador.

### Agregar una nota

El botón Nota permite registrar información sin cambiar el estado de la tarea. Se puede elegir un comentario predefinido y agregar texto libre.

Si la tarea ya tenía notas, el nuevo texto se agrega en una línea separada. Esto conserva lo escrito anteriormente.

Los comentarios predefinidos pueden estar disponibles para todas las estaciones o solo para algunas.

## Por qué una tarea puede aparecer bloqueada

SCP no muestra todas las tareas como si fueran intercambiables. Hay reglas que protegen el orden de fabricación.

### Dependencias

Una tarea puede exigir que una o varias tareas anteriores estén completas. Si faltan, la tarjeta muestra los nombres de esas tareas.

La aplicación verifica las dependencias por separado para cada panel o módulo. Que una tarea esté completa en otro módulo no satisface la dependencia del módulo actual.

### Personas autorizadas

Una tarea puede estar limitada a ciertas personas. Si el nombre del operador no está en la lista, puede ver la tarea, pero no iniciarla ni unirse.

Una especialidad o habilidad requerida también puede filtrar las tareas que aparecen para una persona.

### Trabajo simultáneo

Una tarea puede permitir trabajo simultáneo o puede exigir que la persona se concentre solo en ella.

Cuando no permite trabajo simultáneo, la aplicación bloquea a la persona si ya está participando en otra tarea activa del mismo tipo. También impide elegir para la nueva tarea a alguien que está ocupado de esa manera.

Cuando permite trabajo simultáneo, varias tareas pueden coincidir en el tiempo. Esa coincidencia se conserva y luego aparece en los informes de concurrencia.

### Tarea en otra estación o línea

Si la persona tiene una tarea activa asociada a otra estación o a otra línea, aparece un aviso. La aplicación evita que cambie libremente su foco de trabajo.

La persona puede ver las opciones para escribir una nota, pausar, reanudar o terminar la tarea activa. Si debe terminarla desde otra estación, puede cambiar temporalmente la estación de la sesión, completar la tarea y volver al contexto anterior.

## Cómo avanza un panel y cómo avanza un módulo

### Avance del panel

Para que un panel avance, la aplicación mira las tareas requeridas para ese panel en la estación actual.

1. Si faltan tareas requeridas, el panel permanece en la estación.
2. Si todas están completas u omitidas, SCP busca la siguiente estación de paneles con tareas para ese panel.
3. Si encuentra una estación, mueve allí el panel.
4. Si no encuentra otra, marca el panel como completado.
5. Si todos los paneles aplicables del módulo terminaron, el módulo pasa a Magazine.

Una tarea que no aplica por la configuración del panel o por sus condiciones no se cuenta como pendiente.

### Avance del módulo

Para mover un módulo de una estación de armado a otra, la aplicación necesita que se complete una tarea marcada para impulsar el avance.

Después busca las estaciones siguientes de la misma línea. Para cada una pregunta si tiene al menos una tarea de módulo aplicable. Salta las estaciones que no tienen nada que hacer para ese módulo.

Si encuentra una estación aplicable, la convierte en la estación actual del módulo. Si no encuentra ninguna, el módulo se queda en la estación final para que calidad o administración pueda completar el cierre.

## Objetivo diario de paneles

En un dispositivo que está en una línea de paneles puede aparecer un indicador de objetivo diario. Muestra:

- Cuántos paneles se han terminado ese día.
- Qué paneles y módulos se consideran.
- Cuánto falta para llegar al objetivo.
- Si el resultado está por debajo, en línea o por encima de la meta.
- Una comparación visual entre el avance real y el esperado durante el turno.

El objetivo se define en ese dispositivo y no se comparte automáticamente con todas las tablets. Por eso dos tablets pueden tener metas diferentes si fueron configuradas de manera distinta.

## Retrabajos de calidad dentro de la estación

Cuando una revisión de calidad falla, el retrabajo aparece en las tarjetas de la estación que debe resolverlo. La tarjeta puede mostrar:

- Nombre de la revisión fallida.
- Descripción de lo que debe corregirse.
- Modos de falla.
- Notas del inspector.
- Miniaturas de fotos o videos.

La persona puede iniciar, pausar, reanudar y terminar el retrabajo. SCP registra quién lo hizo y cuánto duró. El retrabajo no reemplaza la revisión original. Cuando termina, la revisión puede volver a abrirse para comprobar la corrección.

La vista de evidencia permite abrir fotos, ampliar imágenes y reproducir videos. El retrabajo sigue el mismo control de pausas y participación que una tarea normal.

## Personal y equipos

### Operadores

En Personal se pueden buscar operadores por nombre o por RUT. También se puede filtrar por:

- Estación.
- Especialidad.
- Estado activo o inactivo.

El formulario de una persona permite registrar:

- Nombre y apellido.
- RUT o vínculo con GeoVictoria.
- Estado activo o inactivo.
- PIN.
- Si el PIN es obligatorio.
- Supervisor.
- Una o varias estaciones asignadas.
- Una o varias especialidades.
- Tiempos ajustados para ciertos cálculos de asistencia.

Una persona inactiva no aparece para nuevos ingresos, pero sus participaciones históricas se conservan.

### Credenciales QR

El botón Credenciales QR genera credenciales imprimibles. Se pueden imprimir varias en una hoja tamaño A4 o Carta. El código de cada credencial permite que la pantalla de ingreso reconozca a la persona rápidamente.

### Supervisores

La pestaña Supervisores permite crear y editar personas responsables de equipos. También se puede vincular su información con GeoVictoria.

El supervisor se usa en la administración del personal, en las observaciones de calidad, en los protocolos y en los informes de asistencia.

### Especialidades

Una especialidad agrupa una habilidad o tipo de trabajo. Se puede crear, cambiar de nombre, eliminar y asignar a varias personas.

Las especialidades ayudan a filtrar las tareas que una persona puede realizar. Una tarea puede pedir una especialidad concreta.

### Equipo administrador

El administrador principal puede crear y editar cuentas administrativas. Cada cuenta puede tener:

- Nombre y apellido.
- Correo de Microsoft.
- PIN.
- Estado activo o inactivo.
- Un rol.

La cuenta principal protegida no se puede editar ni eliminar desde el listado normal. Esto evita que una modificación accidental quite el último acceso de máxima responsabilidad.

## Configuración de tipos de casa, módulos y paneles

La página de configuración de casas organiza la definición del producto en tres partes.

### Tipos de casa y subtipos

Se crea el nombre del tipo de casa y el número de módulos que tiene. Después de guardarlo, se pueden crear sus subtipos.

El número de módulos es importante porque se usa al crear lotes. También define qué módulos se pueden elegir en la cola y en los informes.

### Paneles por módulo

Se elige un tipo de casa y un número de módulo. La pantalla muestra los paneles de ese módulo agrupados por familia.

Al crear o editar un panel se puede indicar:

- Grupo del panel.
- Código del panel.
- Superficie en metros cuadrados.
- Largo en metros.
- Subtipo al que corresponde.
- Tareas de panel que se deben realizar.

La secuencia de paneles se puede ordenar moviéndolos hacia arriba o hacia abajo. El orden se usa para proponer el siguiente panel de la cola.

Un panel puede archivarse. Archivar lo retira de nuevas configuraciones sin borrar necesariamente la historia de paneles que ya fueron fabricados. La pantalla permite consultar paneles activos y archivados, y restaurar un panel archivado.

### Matriz de tareas de panel

La matriz cruza tareas de panel con paneles. En cada cruce se puede decir si la tarea aplica y cuántos minutos se esperan para esa combinación.

Esto permite que dos paneles del mismo módulo tengan trabajos diferentes o que la misma tarea tenga un tiempo esperado distinto según el panel.

### Tareas de módulo por tipo y módulo

La tercera parte de la configuración permite elegir las tareas de módulo que corresponden a cada tipo de casa y cada módulo. Se organizan por estación.

Para cada tarea se puede indicar:

- Si aplica o no.
- La estación o secuencia donde se realiza.
- El tiempo esperado.
- La cantidad de personas esperada.

Este ajuste permite que un mismo tipo de tarea se comporte de manera diferente en distintos módulos.

## Parámetros de casa

La página Parámetros de casa sirve para guardar valores que describen un producto. Un parámetro tiene un nombre y una unidad. La unidad puede ser una medida, una cantidad o cualquier referencia que el equipo necesite.

Para cada tipo de casa se pueden escribir valores por módulo. Si el tipo tiene subtipos, se puede elegir si el valor es general o si pertenece a un subtipo específico.

La pantalla muestra el número de módulos del tipo elegido y marca si los valores son por defecto o si están ajustados por subtipo.

El administrador principal controla esta página porque los parámetros pueden afectar la interpretación del producto.

## Tareas, aplicabilidad y tiempos esperados

La página Tareas muestra el catálogo de actividades. Se puede buscar y filtrar por:

- Nombre.
- Alcance: panel, módulo o auxiliar.
- Estado activo o archivado.
- Estación.
- Especialidad.

Al crear o editar una tarea se puede definir:

- Nombre.
- Alcance.
- Estado activo.
- Secuencia de estación o estación auxiliar.
- Especialidad.
- Si una tarea de panel se puede omitir.
- Si se permite trabajar en paralelo.
- Si una tarea de módulo impulsa el avance.
- Dependencias.
- Personas autorizadas.
- Cuadrilla habitual.
- Condiciones de aplicabilidad.

### Diferencia entre cuadrilla habitual y personas autorizadas

La cuadrilla habitual es una lista de favoritas para comenzar una tarea más rápido. No limita el trabajo.

La lista de personas autorizadas sí limita quién puede iniciar o realizar la tarea. Esta diferencia es importante: una persona puede aparecer como parte de la cuadrilla habitual sin ser la única persona permitida, mientras que una restricción explícita sí bloquea a quien no esté autorizado.

### Archivar una tarea

Una tarea archivada deja de aparecer como una nueva tarea de trabajo. El historial de tareas realizadas no se borra. Esto permite cambiar una forma de trabajo sin perder lo que ocurrió en el pasado.

## Condiciones del producto

En Condiciones se crean los tipos de condición y sus valores.

Ejemplos de tipos:

- Piso.
- Nivel de terminación.
- Paquete opcional.

Dentro de cada tipo se crean valores, por ejemplo, un tipo de piso puede tener valores como estándar o reforzado.

Cada módulo puede recibir uno o varios valores. Las condiciones activas se muestran en las tarjetas de trabajo y se usan para decidir si una tarea aplica.

## Cómo decide SCP si una tarea aplica

La aplicación busca la regla más precisa disponible. El orden general es:

1. Una regla para un panel concreto.
2. Una regla para un tipo de casa y un módulo.
3. Una regla para un tipo de casa.
4. Una regla general para todos.

Si el panel tiene una matriz propia de tareas, esa matriz define qué tareas se consideran para ese panel. El tipo de casa, el módulo, el subtipo y las condiciones pueden reducir aún más el conjunto.

Una regla de condición puede decir:

- Es: el módulo debe tener al menos uno de los valores elegidos.
- No es: el módulo no debe tener ninguno de los valores elegidos.

Todas las reglas que se aplican a una tarea deben cumplirse. Si una tarea no tiene reglas de condición, se considera aplicable según las demás reglas. Si una tarea pide un valor y el módulo no lo tiene, la tarea no se muestra como pendiente.

## Pausas y comentarios predefinidos

### Razones de pausa

En Pausas se crean las razones que pueden elegir los operadores. Una razón puede estar disponible para todas las estaciones o solo para estaciones concretas.

Se puede activar o desactivar una razón. Desactivarla evita que se use en pausas nuevas, pero no elimina el historial de pausas anteriores.

### Plantillas de comentarios

En Comentarios se crean textos que ayudan a escribir notas repetidas. Una plantilla puede estar disponible para todas las estaciones o para algunas.

El operador puede elegir la plantilla y agregar información libre. La plantilla no reemplaza la nota escrita por la persona. El resultado completo queda en el historial de la tarea.

## Cola de producción

La Cola de producción es el punto de entrada para crear y ordenar el trabajo.

### Crear un lote

El botón Agregar lote de producción pide:

- Proyecto.
- Base del identificador de casa.
- Tipo de casa.
- Cantidad de casas.
- Subtipo si existe.
- Fecha y hora planificadas.

La pantalla calcula cuántos módulos se crearán antes de guardar. También sugiere el siguiente identificador cuando ya hay casas con una base similar.

### Ver la cola

La cola agrupa los módulos por proyecto. Cada tarjeta o fila muestra:

- Número de producción.
- Proyecto.
- Identificador de casa.
- Número de módulo.
- Tipo de casa.
- Subtipo.
- Fecha planificada.
- Línea de armado.
- Estado del módulo.

Se puede buscar por los datos visibles y elegir uno o varios módulos.

### Seleccionar y modificar varios módulos

Se puede seleccionar un módulo con un clic, varios con Ctrl o Command, o un rango con Shift.

Sobre los seleccionados se pueden cambiar:

- Fecha y hora planificadas.
- Tipo de casa, cuando todos estén Planificados y la estructura sea compatible.
- Subtipo.
- Condiciones.
- Línea de armado.
- Estado, como medida de último recurso.

Cuando se cambia el tipo de casa para una selección, la aplicación verifica que las casas tengan la misma estructura de módulos. No permite aplicar una estructura distinta sin esa comprobación.

### Reordenar

Los módulos activos se pueden arrastrar, subir o bajar. Los módulos completados permanecen al final.

También existe Editar números para corregir los números planificados. Los números deben ser positivos y no repetirse dentro del mismo proyecto. La aplicación avisa si hay duplicados.

El orden de la cola orienta el trabajo en la primera estación de paneles. No altera por sí mismo las tareas que ya se hicieron.

### Cambiar de línea

Los módulos activos pueden cambiarse entre las líneas 1, 2 y 3. Un módulo completado no puede cambiar de línea.

Si un módulo pasa a armado sin línea definida, SCP intenta ubicarlo en la primera estación aplicable de la línea elegida.

### Cambiar el estado manualmente

Editar estado está descrito como último recurso. Sirve para reencauzar un módulo cuando una situación real no coincide con el estado registrado.

Cambiar el estado no borra automáticamente:

- Paneles.
- Tareas completadas.
- Pausas.
- Notas.
- Historial.

Mover un módulo hacia atrás puede dejar información de trabajo más avanzada que el estado visible. Por eso la pantalla muestra advertencias antes de confirmar.

### Editar condiciones

Las condiciones se pueden cambiar desde una matriz. Cada fila es un módulo y cada columna es un valor de condición.

Se puede:

- Marcar o quitar un valor para un módulo.
- Activar o desactivar una condición para todos los módulos visibles.
- Trabajar sobre toda la cola visible.
- Trabajar solo sobre los módulos seleccionados.

Para una selección también existen tres modos:

- Agregar: suma los valores elegidos sin tocar los demás.
- Quitar: elimina los valores elegidos.
- Reemplazar: deja exactamente los valores elegidos y quita los demás.

Después de cambiar condiciones, las tareas que dependen de ellas pueden aparecer o dejar de aparecer.

### Ver el detalle de un módulo

El detalle muestra:

- Estado del módulo.
- Proyecto, casa, tipo y subtipo.
- Línea y estación actual.
- Paneles del módulo.
- Estado de cada panel.
- Tareas pendientes de cada panel.
- Tareas de módulo.
- Paneles terminados frente al total.
- Avance general de tareas.

Esto permite revisar un módulo sin entrar como operador en una estación.

### Eliminar

La eliminación de módulos o lotes es irreversible desde la pantalla. La aplicación muestra una advertencia antes de confirmarla.

Archivar definiciones de producto es diferente de eliminar una orden de producción. Archivar conserva el pasado; eliminar una orden quita el elemento de trabajo.

## Estaciones y cámaras

En Estaciones se pueden crear y ordenar lugares de trabajo. Cada estación tiene:

- Nombre.
- Rol: Paneles, Magazine, Armado o Auxiliar.
- Línea, cuando es una estación de armado.
- Secuencia dentro de la línea.
- Estado activo.

Las estaciones de armado de una misma línea se ordenan por secuencia. Esa secuencia decide el recorrido del módulo.

Una estación puede tener una cámara asociada. Desde las pantallas de supervisión se puede abrir la imagen de esa cámara si está disponible. La cámara se muestra por dirección de red y puede no estar disponible aunque la estación siga funcionando para registrar tareas.

La página también incluye el control de protección contra cambios de estación del dispositivo. Se aplica localmente al equipo en el que se activa.

## Estimación de turnos por estación

La estimación de turnos utiliza los marcajes de entrada y salida de las personas asignadas a cada estación. No es una declaración manual del horario; es una estimación basada en la presencia encontrada.

### Regla de cálculo actual

La pantalla explica estas reglas:

- Si existe al menos un marcaje en la estación, el inicio se fija a las 08:20.
- La salida se estima como la última salida encontrada menos 30 minutos.
- Si no existe ningún marcaje, la estación queda Sin turno.

La deducción de treinta minutos intenta representar el tiempo entre dejar el trabajo y marcar la salida.

### Qué muestra

La pantalla presenta:

- Turnos estimados.
- Estaciones sin salida.
- Estaciones sin marcajes.
- Cobertura de la información disponible.
- Última salida detectada.
- Estación.
- Secuencia.
- Líneas paralelas.
- Personas asignadas y personas presentes.
- Inicio, última salida, fin estimado y duración.
- Estado del cálculo.

Las estaciones que tienen la misma secuencia se pueden mostrar agrupadas, porque representan posiciones paralelas del recorrido.

### Cálculo de rangos

Se puede calcular un rango de días pasados. La aplicación limita el tamaño de cada cálculo y muestra cuántos días procesó y cuántos errores de marcaje encontró.

También se puede activar el cálculo automático diario. La pantalla indica que se ejecuta a las 23:00 para estimar los turnos del día.

La cobertura permite saber qué parte del historial está disponible y si un día todavía no ha sido calculado.

## Etiquetas e impresión

La página Etiquetas prepara una etiqueta para el último módulo que tiene actividad de producción.

### Qué información puede incluir

Se pueden seleccionar uno o varios campos:

- Número de producción.
- Proyecto.
- Módulo.
- Panel.

El panel se muestra solo cuando la actividad elegida corresponde a un panel. La pantalla exige conservar al menos un campo.

Se puede elegir entre una y cinco copias. La vista previa se muestra en formato horizontal y permite verificar la información antes de imprimir.

### Cómo elige el último módulo

SCP intenta encontrar, en este orden:

1. Un módulo con una tarea activa.
2. El módulo con actividad más reciente.
3. El primer elemento pendiente de la cola.

Si no hay módulos disponibles, la vista previa lo informa.

### Impresora

La pantalla funciona aunque no haya impresora configurada. En ese caso se puede revisar la vista previa, pero no se puede enviar una muestra.

Cuando existe una impresora Zebra ZD420 configurada y conectada por la red, el botón Enviar muestra guarda la configuración y manda una copia de prueba. La pantalla también indica si falta la conexión con la impresora.

## Copias de seguridad y recuperación

La página Respaldos está reservada al administrador principal.

### Copia manual

Se puede crear una copia manual y agregarle una etiqueta, por ejemplo, antes de una operación de mantenimiento. La pantalla muestra:

- Fecha.
- Tamaño.
- Nombre de la copia.
- Cantidad de copias disponibles.
- Retención configurada.

### Copias automáticas

Se puede activar el proceso automático y configurar:

- Cada cuántos minutos se crea una copia.
- Cuántas copias se conservan.

Cuando se supera la cantidad de retención, las copias más antiguas se eliminan según la regla configurada.

### Restaurar

Restaurar una copia reemplaza la información activa por la información de esa copia. Antes de hacerlo, SCP crea una copia de control del estado actual. También puede cerrar las sesiones activas para que nadie siga trabajando con una información que acaba de cambiar.

La copia anterior queda archivada para poder identificar qué había antes de la restauración.

### Traer la información de producción

En el equipo local existe una herramienta para traer la información de la instalación de producción. Está limitada al administrador principal y solo se muestra desde el equipo autorizado.

Para evitar una activación accidental, pide escribir SINCRONIZAR. Antes de reemplazar la información local crea una copia de control, cierra las sesiones y archiva el estado anterior.

Esta operación trae la información operativa, pero no copia:

- Fotos de la galería general.
- Evidencias de calidad.
- Archivos de observaciones.
- Archivos subidos por usuarios.
- Configuración local de cámaras.
- Configuración local de impresoras.
- Ajustes propios de la instalación.

## Control de calidad

El área de calidad tiene su propio estilo de navegación y está pensada para usarse en una tablet o en un computador.

Sus páginas principales son:

- Menú principal.
- Dashboards de calidad.
- Biblioteca.
- Observaciones.
- Checks.
- Nueva inspección.
- Ejecución de inspección.

En la cabecera se muestra la última actualización y el intervalo de actualización automática cuando la pantalla lo usa.

## Menú principal de calidad

El menú principal reúne la situación de la planta en cuatro bloques:

- Checks pendientes.
- Retrabajos.
- Paneles en planta.
- Módulos en armado.

También muestra las observaciones abiertas.

### Filtro por estación

Los checks pendientes se pueden filtrar por una o varias estaciones. La selección se recuerda en ese dispositivo.

En la vista de planta, los paneles y módulos se agrupan por estaciones de paneles y por líneas de armado. Cada estación puede mostrar:

- Checks abiertos.
- Retrabajos activos.
- Paneles o módulos que están en ese lugar.
- Observaciones abiertas.

### Cerrar un módulo desde calidad

Una persona con el rol necesario puede marcar un módulo como completado desde el menú de calidad. La aplicación no elimina el historial ni las evidencias; cambia el estado del módulo y marca sus paneles como consumidos.

## Catálogo de controles de calidad

El Catálogo de checks permite definir una revisión una sola vez y reutilizarla.

### Datos generales de un control

Cada control puede tener:

- Nombre.
- Categoría y subcategoría.
- Tipo de revisión.
- Estado activo o inactivo.
- Versión.
- Instrucciones para el inspector.

Hay dos formas principales:

- Check disparado: se abre a partir de una tarea determinada.
- Plantilla manual: se puede elegir desde una inspección manual.

### Modos de falla

Un modo de falla describe un problema conocido que puede aparecer durante una revisión. Puede tener:

- Nombre.
- Descripción.
- Severidad sugerida.
- Instrucciones de retrabajo sugeridas.

Cuando el inspector marca una falla, puede elegir uno o varios modos de falla. Si no existe un modo configurado, puede escribir una falla libre cuando la pantalla lo permita.

Las severidades disponibles son baja, media y crítica.

### Imágenes de guía y de referencia

Un control puede tener imágenes de dos tipos:

- Guías: explican cómo realizar la revisión.
- Referencias: muestran ejemplos del resultado esperado o de una falla.

Durante la ejecución, el inspector puede desplazarse entre las imágenes. Esto ayuda a mantener el mismo criterio entre distintas personas.

### Gatillantes de controles

Un gatillante indica qué tarea puede abrir una revisión. Actualmente se usa la finalización de una tarea.

Para un gatillante se puede elegir:

- Una o varias tareas.
- Una tasa base de muestreo.
- Un aumento o disminución de la tasa.
- Si la tasa puede ajustarse automáticamente según los resultados.

El muestreo permite revisar una parte de las unidades en vez de abrir el control para absolutamente todos los casos.

La pantalla avisa si un gatillante apunta a tareas inactivas o que ya no existen. Esto ayuda a corregir la configuración antes de que falten controles.

### Aplicabilidad de un control

Un control puede limitarse por:

- Uno o varios tipos de casa.
- Uno o varios subtipos.
- Uno o varios grupos de panel.

Si no se selecciona una limitación, el control puede aplicarse de manera general. La aplicación verifica esa aplicabilidad antes de abrir una revisión automática o antes de ofrecer una plantilla manual.

## Crear una inspección manual

La opción Nueva inspección permite abrir una revisión fuera del momento automático.

### Revisión libre

En Revisión libre se escribe un título propio. Sirve para un control puntual que no existe como pauta permanente.

### Check definido

En Check definido se elige una pauta existente. La pauta se usa de inmediato, sin esperar a que ocurra su gatillante normal.

### Ubicar la inspección

La persona elige:

- Módulo objetivo.
- Panel, si el módulo está en estado Paneles.
- Check o título.

La aplicación detecta el alcance por el estado del módulo:

- En Paneles, la inspección se ubica en un panel.
- En Magazine o Armado, la inspección se ubica en el módulo.

También muestra la estación detectada para confirmar que se eligió el elemento correcto.

Las inspecciones manuales solo se pueden crear sobre módulos que están actualmente en producción. No se crean sobre un módulo planificado o ya cerrado.

## Ejecutar una revisión

La pantalla de ejecución se abre directamente cuando se crea el control.

### Leer la pauta

El inspector ve:

- Nombre del control.
- Ubicación del módulo o panel.
- Estación.
- Instrucciones.
- Imágenes de guía.
- Imágenes de referencia.
- Pasos de la revisión.

El botón Siguiente avanza por los pasos. En tablets se pueden cambiar las imágenes con un gesto lateral.

### Adjuntar evidencia

La evidencia es el registro visual de lo que se encontró. Se pueden adjuntar:

- Fotos tomadas con la cámara del equipo.
- Videos grabados con la cámara.
- Fotos o videos seleccionados desde el equipo.

La pantalla permite revisar cada archivo, eliminarlo, volver a intentar una carga que falló y abrirlo en grande.

Los videos de la ejecución pueden durar hasta dos minutos y tener un tamaño máximo de 50 MB. La grabación de video de esta pantalla se realiza sin audio.

Al tomar una foto desde los controles de calidad, la aplicación puede añadir una marca con datos como proyecto, casa, módulo, panel, título y fecha. Esa marca ayuda a relacionar la evidencia con el hallazgo.

### Aprobar

Al final de los pasos, Aprobar guarda el resultado aprobado. La revisión queda cerrada.

En la versión actual de la pantalla, aprobar exige que exista al menos una foto o un video. Esto obliga a dejar un registro visual incluso cuando el resultado es correcto.

### Fallar

Para registrar una falla se debe:

1. Adjuntar una foto o un video.
2. Elegir al menos un modo de falla si la pauta tiene modos configurados.
3. Elegir una severidad.
4. Escribir, si es necesario, instrucciones específicas de retrabajo.
5. Confirmar la falla.

La severidad puede ser baja, media o crítica. Si se deja vacío el texto del retrabajo, SCP intenta usar la instrucción predeterminada del modo de falla. Si tampoco existe, guarda una descripción general de retrabajo requerido.

Una falla crea un retrabajo abierto y puede crear avisos para las personas relacionadas con la tarea que originó el control. La revisión se cierra con resultado fallido, pero no se considera resuelta hasta que el retrabajo termine y se haga una nueva revisión.

### Notas de la revisión

El inspector puede agregar una nota antes de cerrar el control. La nota queda asociada a la ejecución y aparece en la ficha de la revisión.

## Reinspección después de un retrabajo

Cuando un control falló y tiene un retrabajo abierto, no se permite cerrar una nueva ejecución como si nada hubiera ocurrido. Primero se debe terminar el retrabajo.

Una vez terminado:

1. El retrabajo queda Finalizado.
2. Se liberan los avisos activos de ese retrabajo.
3. La revisión puede volver a ejecutarse.
4. La nueva ejecución puede aprobar o volver a fallar.

Si vuelve a fallar, se crea otro ciclo de retrabajo y revisión. La Biblioteca conserva todos los ciclos.

## Biblioteca de calidad

La Biblioteca es el historial de calidad agrupado por casa y módulo.

### Buscar y filtrar

Se puede buscar por:

- Casa.
- Módulo.
- Proyecto.
- Tipo de casa.

También se puede filtrar para ver:

- Todos los módulos.
- Solo módulos con controles abiertos.
- Solo módulos con fallas.
- Un alcance concreto, como módulo, panel o un panel específico.

La lista muestra cuántas casas y módulos están cargados, cuántos controles están abiertos y cuántos retrabajos siguen abiertos.

### Ficha de un módulo

Al abrir un módulo se ve una hoja de historial con:

- Controles totales.
- Controles abiertos.
- Fallas.
- Retrabajos.
- Evidencias.
- Estado del módulo.
- Proyecto, casa y tipo.

Cada control aparece como una historia. La historia puede incluir:

- Apertura del control.
- Tarea que lo generó.
- Inspector.
- Resultado de cada ejecución.
- Notas.
- Modos de falla.
- Evidencias.
- Retrabajos.
- Intentos de corrección.
- Cierre del control.

La vista permite filtrar la hoja por controles abiertos, controles con fallas, paneles y módulos.

### Crear una inspección desde la Biblioteca

Si el módulo está en un estado que permite revisión, se puede abrir Nueva inspección desde su ficha. La aplicación ofrece solo las pautas manuales aplicables al módulo y al panel elegido.

Si una pauta ya tiene un control abierto para el mismo objetivo, la lista lo indica y evita crear duplicados innecesarios.

### Administrar evidencia

Una persona de calidad puede agregar evidencia a una ejecución existente o eliminarla cuando la pantalla lo permite. Las imágenes se pueden abrir en un visor y los videos se pueden reproducir.

La ficha muestra una advertencia cuando la gestión de evidencia no está permitida. Un control fallido con retrabajo asociado no se puede eliminar de forma normal porque su historial es necesario para entender la corrección.

La pantalla contempla una regla de cuarenta y ocho horas para eliminar controles o evidencias desde su apertura. En la versión revisada, esa comprobación aparece temporalmente desactivada en la experiencia de la aplicación. La restricción por retrabajo asociado sí se mantiene como protección importante.

## Observaciones de calidad

Las observaciones son conversaciones sobre hallazgos de planta. Se pueden abrir desde el menú de calidad o desde las vistas de supervisión.

### Crear una observación

La persona debe elegir:

- Módulo.
- Panel, si corresponde.
- Severidad baja, media o crítica.
- Título.
- Descripción.
- Uno o varios supervisores responsables.
- Fotos iniciales si son necesarias.

La aplicación muestra solo módulos disponibles para el alcance de la observación. Si el módulo está en Paneles, exige elegir un panel.

### Historial de una observación

Cada observación conserva:

- Quién la creó.
- Fecha de creación.
- Cambios de estado.
- Comentarios.
- Fotos y videos asociados.
- Supervisores responsables.
- Fecha de propuesta de cierre.
- Fecha de cierre.

La conversación queda ordenada en el tiempo. Una foto tomada desde la pantalla puede incluir una marca con el contexto de la observación.

### Estados de una observación

| Estado | Qué significa |
| --- | --- |
| Abierta | El hallazgo sigue pendiente de resolver. |
| Cierre propuesto | Un supervisor indica que considera resuelto el hallazgo y pide validación. |
| Cerrada | Calidad acepta el cierre. |

Un supervisor puede proponer el cierre, pero no lo cierra por sí solo. Calidad puede aceptar la propuesta o rechazarla. Si la rechaza, la observación vuelve a Abierta y se registra el motivo del cambio en la conversación.

Una observación cerrada no acepta nuevos comentarios ni nuevos archivos. Una observación abierta sí permite continuar la conversación.

### Notificaciones de observaciones

Los supervisores reciben avisos cuando hay una observación relacionada con ellos o cuando la conversación cambia. Al abrirla, pueden marcar los avisos como vistos.

## Dashboards de calidad

### Cumplimiento de controles

Este informe pide una fecha inicial y una fecha final. Muestra:

- Total de controles.
- Controles disparados automáticamente.
- Controles que no se realizaron.
- Controles que siguen abiertos.
- Observaciones que siguen abiertas.
- Módulos con pendientes.

El objetivo es responder si los controles que debían ocurrir realmente se realizaron y se cerraron.

### Análisis de fallas

Este informe muestra dónde se concentran los problemas. Incluye:

- Controles ejecutados.
- Cantidad de fallas.
- Porcentaje de falla sobre los controles realizados.
- Controles con fallas repetidas.
- Retrabajos abiertos.
- Checks críticos.
- Tareas con más fallas.
- Estaciones con más fallas.
- Fallas por día.
- Modos de falla.
- Severidades.

El porcentaje se calcula sobre los controles ejecutados en la misma tarea, estación o pauta. No se divide por toda la producción, porque una unidad sin control no debe contarse como si hubiera sido aprobada o fallida.

### Informe descargable

El área de calidad también puede generar un informe descargable con el resumen del tablero cuando esa opción está habilitada.

## Supervisión de la línea de paneles y armado

La Vista de supervisor reúne producción y calidad en una pantalla de seguimiento.

### Pestañas de producción

La pantalla se divide en:

- Paneles.
- Armado.

En Paneles se muestran las estaciones de paneles y los trabajos ubicados allí. En Armado se muestran las estaciones de las líneas y los módulos en cada posición.

Las estaciones se ordenan por línea y secuencia. Cada tarjeta puede mostrar:

- Nombre de la estación.
- Línea.
- Paneles o módulos presentes.
- Tareas completadas.
- Tareas pendientes.
- Personas asociadas.
- Tareas atrasadas.

La pantalla se actualiza periódicamente para que el supervisor vea cambios recientes.

### Alertas de supervisor

La vista concentra contadores de:

- Retrabajos abiertos.
- Checks fallidos.
- Tareas atrasadas.
- Observaciones abiertas.

Al hacer clic en una alerta, se abre el detalle correspondiente. Por ejemplo, una tarea atrasada muestra el módulo, el panel, la estación y la tarea que aún no termina.

### Detalle de un check fallido

El supervisor puede abrir el check relacionado, ver el modo de falla, la severidad, las notas y la evidencia disponible. Esto ayuda a decidir quién debe resolver el retrabajo.

### Detalle y conversación de una observación

El supervisor puede abrir una observación, ver su contexto, escribir comentarios, adjuntar una foto y proponer el cierre si considera que el problema se resolvió.

Las acciones de aceptación o rechazo del cierre quedan para la persona autorizada de calidad.

## Estado de planta

Estado de planta es una vista de consulta del armado. Agrupa las estaciones por línea y las ordena de arriba hacia abajo según el recorrido.

Para cada estación muestra:

- Secuencia.
- Línea.
- Módulos activos.
- Paneles cuando corresponda.
- Tareas de la estación.
- Otras tareas.
- Tareas pendientes de estaciones anteriores.
- Cantidad de tareas completadas frente al total.

Las tareas de cada módulo se pueden expandir o contraer. La pantalla tiene un botón de actualización y deja separadas las estaciones sin módulos activos.

Esta vista sirve para mirar la situación general sin tomar control de una tarea. No reemplaza el espacio de trabajo del operador.

## Protocolos de seguridad

La página Protocolos de Seguridad sirve para publicar documentos de seguridad, asignarlos a supervisores y registrar que fueron leídos.

### Consultar protocolos

La lista muestra:

- Título.
- Versión vigente.
- Fecha de publicación.
- Cantidad de documentos.
- Supervisores a los que aplica.
- Si la persona que inició sesión ya firmó la última versión.

Se puede buscar por título y, cuando hay una sesión de supervisor, filtrar para ver solo los protocolos que le corresponden.

### Documentos y formatos

Un protocolo puede tener uno o varios documentos. La aplicación acepta archivos PDF y DOCX. Dentro de una misma versión evita repetir el mismo nombre de archivo.

Los documentos se pueden previsualizar o descargar.

### Crear un protocolo

Una persona con permisos de administración puede:

1. Escribir el título.
2. Seleccionar los supervisores responsables.
3. Adjuntar al menos un documento.
4. Publicar el protocolo.

### Publicar una nueva versión

Cuando cambia un procedimiento, se crea una nueva versión. La persona responsable adjunta los documentos nuevos y escribe un resumen de cambios.

La aplicación muestra la versión anterior para poder comparar qué cambió. También reinicia la necesidad de firma para los supervisores a quienes aplica la nueva versión.

### Firmar un protocolo

El supervisor inicia sesión seleccionando su nombre e ingresando su PIN. Puede ver sus protocolos pendientes y firmar la última versión que le corresponde.

La firma conserva:

- Nombre con el que se firmó.
- Supervisor.
- Fecha y hora.
- Versión del protocolo.

Una vez firmada la versión, la tarjeta cambia a Firmado para ese supervisor.

### Seguimiento de firmas

Una persona administradora puede ver quiénes ya firmaron y quiénes están pendientes. El supervisor recibe un contador de protocolos pendientes en la cabecera y en el acceso rápido de Ajustes.

## Catálogo general de análisis

La página llamada Dashboards muestra las pantallas de análisis disponibles. Cada tarjeta explica su propósito. Se pueden marcar como favoritas; las preferencias se recuerdan en el navegador o dispositivo donde se seleccionaron.

El administrador principal puede decidir qué roles pueden ver cada panel de análisis. Un panel puede estar visible en modo consulta sin permitir cambios de configuración.

Los paneles de análisis disponibles son:

1. Vista de planta.
2. Metros lineales por panel.
3. Histórico producción paneles.
4. Paneles finalizados por estación.
5. Análisis de tiempos de tareas.
6. Tareas con grabación de cámaras.
7. Adherencia de estación.
8. Secuencia de tareas.
9. Asistencias y actividad.
10. Asistencia y producción.

La pantalla de grabaciones relaciona una tarea con el tramo de video de las cámaras de la planta que coincide con su horario.

## Vista de planta

La tarjeta se presenta como un mapa vivo, pero la pantalla actual funciona como un visor de recorrido. Permite cargar un archivo de tabla de datos o cargar una demostración.

### Qué puede cargar

Cada fila del archivo puede representar una actividad con:

- Estación.
- Operador.
- Proyecto.
- Casa.
- Módulo.
- Panel.
- Inicio.
- Fin.
- Tiempo esperado.
- Duración.
- Pausa.

La aplicación muestra un error si el archivo no tiene el formato esperado.

### Cómo se usa

La pantalla calcula un rango de tiempo y muestra:

- Estaciones activas o inactivas.
- Operadores activos.
- Tarea actual.
- Módulo o panel actual.
- Tiempo transcurrido.
- Tiempo esperado.
- Última tarea.
- Próxima tarea.

El botón de reproducción abre una vista completa. Se puede:

- Reproducir.
- Pausar.
- Reiniciar.
- Mover el control de tiempo.
- Usar velocidades de 0,5, 1, 2 o 4 veces.
- Cambiar entre Paneles y Terminaciones.

La vista sirve para explicar o revisar una secuencia de turno a partir de registros cargados. No representa por sí sola una conexión directa con la actividad viva de cada estación.

## Metros lineales por panel

Este panel de análisis compara el tiempo de fabricación de paneles teniendo en cuenta el tamaño de cada panel.

### Filtros

Se puede elegir:

- Tipo de casa.
- Fecha inicial.
- Fecha final.
- Multiplicador mínimo.
- Multiplicador máximo.

Los multiplicadores filtran muestras demasiado alejadas del tiempo esperado. Por ejemplo, con un mínimo de 0,5 y un máximo de 2, se conservan muestras entre la mitad y el doble del tiempo esperado.

### Resultados

La tabla puede mostrar:

- Tipo de casa.
- Módulo.
- Grupo del panel.
- Código.
- Largo del panel.
- Tiempo promedio por estación.
- Metros por minuto.
- Cantidad de muestras.

Se pueden incluir o excluir filas para comparar solo una parte de los resultados. La pantalla calcula el total de metros, el total incluido y el promedio.

El valor metros por minuto se obtiene dividiendo el largo del panel por el tiempo promedio de trabajo. Un valor más alto significa que se fabricaron más metros durante cada minuto registrado.

### Pausas

El panel de análisis resume las pausas del rango elegido:

- Tiempo total en pausa.
- Minutos por razón.
- Cantidad de pausas por razón.
- Minutos por estación.

Al abrir una razón o una cantidad, se pueden ver las tareas relacionadas, el proyecto, la casa, el módulo, el panel, la estación, la hora de inicio, la hora de término y la duración.

## Histórico por estación

Este panel de análisis corresponde a Histórico producción paneles y permite revisar el trabajo ya terminado.

### Dos formas de consulta

Se puede consultar:

- Paneles.
- Módulos.

Se elige una fecha inicial y una fecha final. La aplicación recuerda ese rango en el dispositivo.

### Filtros y orden

La tabla permite filtrar por:

- Tarea.
- Panel o proyecto.
- Tipo de casa.
- Subtipo.
- Identificador de casa.
- Módulo.
- Estado del módulo.
- Estación.
- Trabajador.
- Nota.

Las columnas se pueden ordenar. La información incluye inicio, fin, duración, tiempo esperado, pausas, estación, persona y notas.

### Exportar

El botón de exportar tabla descarga la información visible en un archivo que se puede abrir como hoja de cálculo. Incluye el rango, las tareas y el detalle de pausas.

### Corregir una tarea elegible

En la consulta de módulos puede aparecer Deshacer para una tarea corregible. La acción no está disponible para cualquier registro. SCP revisa que el módulo siga activo y que la tarea sea elegible.

Cuando se aplica, puede:

- Eliminar el registro de esa tarea.
- Quitar sus participaciones.
- Quitar sus pausas.
- Quitar hechos de adherencia relacionados.
- Quitar controles de calidad abiertos por esa tarea.
- Quitar retrabajos y avisos relacionados cuando corresponda.
- Revertir el movimiento del módulo si la tarea fue la que lo hizo avanzar.

La pantalla muestra una advertencia antes de aplicar la corrección. Corregir una tarea no es lo mismo que cambiar manualmente el estado del módulo: intenta retirar las consecuencias de esa tarea concreta.

## Paneles finalizados por estación

Este panel de análisis revisa los paneles que pasaron por una estación de paneles en un día determinado.

### Resumen

Muestra:

- Cantidad diaria de paneles terminados.
- Superficie producida en metros cuadrados.
- Balance diario.

La pantalla permite ir al día anterior o siguiente, escribir una fecha, actualizar y exportar.

### Línea de tiempo

Cada panel puede mostrar:

- Espera antes de comenzar.
- Trabajo activo.
- Pausas.
- Espacio sin actividad entre un panel y el siguiente.
- Tiempo por encima de lo esperado.
- Tiempo ahorrado frente a lo esperado.

La leyenda de colores ayuda a distinguir los tramos. Al seleccionar un panel se abre un detalle con:

- Código.
- Casa.
- Módulo.
- Inicio.
- Fin.
- Tiempo esperado.
- Tiempo real.
- Diferencia.
- Tareas.
- Personas.
- Notas.
- Pausas y razones.

El cálculo respeta el turno de la planta. Cuando no hay un turno calculado, utiliza como referencia el horario de 08:20 a 17:00. El balance combina pausas, espacios sin actividad, tiempo adicional y tiempo ahorrado para dar una señal general del uso del turno.

## Análisis de tiempos de tareas

Este es uno de los paneles de análisis más completos. Tiene tres formas de mirar los tiempos.

### Tiempo específico

Se elige:

- Tipo de casa.
- Alcance: panel o módulo.
- Panel o número de módulo.
- Estación.
- Tarea opcional.
- Trabajador opcional.
- Fecha inicial y final opcionales.

La aplicación compara el tiempo real con el tiempo esperado y puede mostrar:

- Promedio real.
- Tiempo esperado de referencia.
- Promedio filtrado.
- Histograma de tiempos.
- Muestras incluidas.
- Muestras excluidas.
- Tabla ordenable.
- Línea de tiempo de cada muestra.

Si no se elige una tarea, una muestra representa un panel o un módulo completo. Si se elige una tarea, una muestra representa una ejecución de esa tarea.

### Histograma

El histograma agrupa las duraciones en franjas, por ejemplo, de dos en dos minutos. El tamaño de esas franjas se puede cambiar.

Cada barra muestra cuántas muestras cayeron en ese intervalo. El panel de análisis dibuja líneas de referencia para el tiempo esperado, el promedio filtrado y el promedio de una hipótesis cuando existe.

### Muestras incluidas y excluidas

Los multiplicadores mínimo y máximo definen un rango alrededor del tiempo esperado. Las muestras fuera de ese rango aparecen separadas para que no oculten el comportamiento habitual.

En modo panel o módulo, la aplicación exige que el conjunto esperado de tareas esté completo. Si falta una tarea o sobra una tarea fuera de la configuración comparable, la muestra puede quedar fuera del cálculo estricto.

Se puede activar Incluir muestras sin tiempo esperado. Si se deja apagado, las muestras sin un tiempo de referencia no participan en la comparación.

### Línea de tiempo de una muestra

Al abrir una muestra se puede ver:

- Inicio.
- Fin.
- Duración activa.
- Duración sin ajustar.
- Pausas contabilizadas.
- Tramos de trabajo.
- Tramos de pausa.
- Tramos que quedaron fuera del turno.
- Tareas que formaron la muestra.

Cuando varias tareas se superponen, la línea de tiempo lo muestra en carriles separados.

La duración de un panel o módulo se calcula uniendo los intervalos de sus tareas y restando las pausas. No se suman ciegamente todos los tiempos si dos tareas ocurrieron al mismo tiempo.

### Hipótesis de filtrado

En Tiempo específico se puede agregar una hipótesis para comparar una parte del historial:

- Trabajador igual a una persona.
- Fecha igual, anterior, posterior o dentro de una comparación elegida.

La pantalla muestra el promedio de las muestras que coinciden con la hipótesis. La hipótesis se puede editar o quitar sin modificar los registros de producción.

### Tareas por estación

Esta pestaña agrupa el historial por tarea y muestra:

- Cantidad de muestras.
- Promedio real.
- Promedio esperado.
- Proporción entre real y esperado.
- Tiempo mínimo.
- Tiempo máximo.
- Última fecha registrada.
- Señal de tendencia.

La señal de tendencia ayuda a ver si una tarea suele ser más rápida o más lenta que lo esperado. Un valor negativo indica una tendencia más rápida y uno positivo una tendencia más lenta. La señal es más confiable cuando hay varias muestras.

Las columnas se pueden ordenar para encontrar las tareas más lentas, las más frecuentes o las que tienen mayor diferencia frente al esperado.

### Tiempo normalizado

Esta pestaña compara paneles de distinto tamaño dentro de una misma estación. Se puede elegir:

- Tiempo por metro lineal.
- Tiempo por metro cuadrado.
- Tipo de casa.
- Grupo de panel.
- Fecha inicial y final.
- Rango mínimo y máximo.
- Tamaño de las franjas del histograma.

La fórmula sencilla es:

Tiempo normalizado = minutos de trabajo divididos por el largo o la superficie del panel.

La pantalla muestra:

- Total de paneles considerados.
- Muestras incluidas.
- Promedio por unidad de medida.
- Muestras sin largo, superficie o tiempo válido.
- Panel más rápido.
- Panel más lento.

Se puede ver la distribución como histograma o como gráfico de dispersión. En el gráfico de dispersión se pueden mostrar todos los puntos o solo promedios por medida.

También se puede mostrar una línea de tendencia y una banda de confianza del 95 por ciento. La línea ayuda a entender si los paneles más grandes tienden a necesitar más tiempo. No es una promesa de duración para cada panel individual.

## Tareas con grabación de cámaras

Este panel de análisis cruza tareas terminadas con los segmentos de grabación de las cámaras.

### Filtros y estados

Se puede filtrar por:

- Fecha.
- Estación.
- Estado de la grabación.
- Tarea, casa, panel, operador o dirección de cámara.

Cada fila muestra:

- Tarea.
- Proyecto.
- Casa.
- Módulo.
- Panel.
- Estación.
- Operador.
- Inicio y término.
- Cantidad de segmentos encontrados.
- Cobertura completa, parcial o inexistente.

### Reproducir una tarea

Al seleccionar una fila, la aplicación busca los segmentos que se cruzan con el intervalo de la tarea. Si encuentra video, prepara una reproducción recortada al rango de trabajo.

El panel de reproducción muestra:

- El video.
- El intervalo utilizado.
- Los archivos de origen.
- Los segmentos y sus horas.
- El tramo de coincidencia.

Si la cobertura es parcial, la pantalla lo indica. Si no hay grabación, la tarea sigue apareciendo en el historial, pero no existe video reproducible.

## Adherencia de estación

La adherencia compara la estación que estaba planificada con la estación real donde se terminó una tarea.

### Filtros

Se puede elegir:

- Alcance de la tarea.
- Estación real.
- Comportamiento de secuencia.
- Tarea.
- Fecha inicial y final.
- Si se incluyen registros que no participan en el indicador principal.

Los comportamientos de secuencia incluyen:

- Inicio adelantado respecto del plan.
- Inicio tardío respecto del plan.
- Inicio en la secuencia correcta, pero término en una secuencia posterior.

### Resultados

El panel de análisis muestra:

- Porcentaje de adherencia.
- Filas del indicador.
- Coincidencias.
- Desviaciones.
- Registros sin resolución.

Hay dos pestañas:

- Filas: cada tarea terminada, con estación planificada y real.
- Por tarea: resumen de las tareas con más desviaciones.

Una coincidencia significa que el trabajo terminó conforme a la estación esperada. Una desviación queda visible para investigar por qué se hizo en otro lugar o por qué se completó en una secuencia diferente.

## Secuencia de tareas

Este panel de análisis reconstruye el orden real en que se realizan las tareas de un panel o un módulo.

### Filtros

Se puede seleccionar:

- Tipo de casa.
- Panel o módulo.
- Proyecto.
- Rango de fechas.
- Rango de proporción entre real y esperado.
- Si se incluyen retrabajos.
- Si el orden se calcula por inicio o por término.
- Si se muestra la mediana o el promedio.

La mediana representa el caso central y suele ser más resistente a jornadas excepcionales. El promedio usa todos los valores válidos.

### Cómo se lee

Cada unidad tiene su propio recorrido:

- 0 por ciento es el inicio de su primera tarea.
- 100 por ciento es el término de su última tarea.

Cada barra representa el comienzo y el fin típico de una tarea dentro de ese recorrido. Las barras superpuestas muestran tareas que suelen hacerse en paralelo.

La pantalla también muestra:

- Orden típico.
- Consistencia del orden.
- Concurrencia.
- Duración.
- Tiempo esperado.
- Estación dominante.
- Distribución entre estaciones.
- Percentiles 25 y 75.
- Cantidad de muestras.

### Interpretación

Una consistencia alta significa que el orden entre tareas se repite de manera estable. Una consistencia baja significa que la tarea cambia mucho de posición.

Una concurrencia alta significa que la tarea suele superponerse con otra. Una barra larga con pocos minutos activos puede indicar que la tarea permanece abierta mientras se espera a que ocurra otra cosa.

El panel de análisis excluye datos atípicos, retrabajos y registros sin horas válidas según los filtros elegidos. La parte superior informa cuántas unidades quedaron fuera y cuántas tenían un orden suficiente para comparar.

## Asistencias y actividad

Este panel de análisis combina los marcajes de GeoVictoria con la actividad que se registró en SCP.

GeoVictoria es el servicio externo que entrega entradas, salidas, colaciones y otros marcajes de asistencia. Para unir esa información con una persona de SCP, se usa el identificador o RUT asociado en Personal.

### Vista por trabajador

Se elige:

- Estación o grupo de estaciones.
- Trabajador.
- Rango de los últimos días.

La pantalla muestra:

- Días con presencia.
- Tiempo total de presencia.
- Días con actividad.
- Tiempo activo.
- Tiempo en pausa.
- Entrada.
- Salida.
- Colación.
- Retraso cuando existe.
- Tiempo productivo.
- Cobertura esperada.

### Día seleccionado

Para cada día se puede revisar:

- La entrada y la fuente del dato.
- La salida y la fuente del dato.
- Tiempo de presencia.
- Tiempo de colación.
- Retraso.
- Actividad activa.
- Pausas.

La actividad del día se puede ver como:

- Línea de tiempo.
- Tabla de tareas.
- Resumen mensual.
- Indicadores del rango.

La tabla de tareas muestra contexto, tarea, estación, inicio, fin, duración y pausas.

### Presencia sin marcaje

Existe una opción llamada Presencia sin marcaje. Cuando está apagada, un día cuenta como presencia solo si GeoVictoria tiene marcaje.

Cuando está encendida, también puede contar un día en que SCP registra actividad, aunque GeoVictoria no tenga entrada o salida. La pantalla identifica esos días con una advertencia para que no se confundan con presencia comprobada por marcaje.

### Indicadores

Tiempo productivo compara la actividad de trabajo con la presencia neta, descontando la colación. También separa tiempo ocioso, tiempo adicional y tiempo improductivo.

Cobertura esperada compara el total de minutos esperados de las tareas con el tiempo de presencia disponible. Puede superar o quedar por debajo del tiempo productivo porque mide una expectativa, no solo trabajo registrado.

### Vista por estación

La vista por estación agrupa las personas asignadas a:

- Una estación.
- Una secuencia de estaciones de armado.
- Un grupo de paneles.

Cada grupo muestra:

- Cantidad de personas.
- Días con presencia.
- Horas netas.
- Tiempo productivo.
- Tiempo esperado.
- Días con actividad sin marcaje.

Los datos se pueden expandir por estación y luego por persona. Las advertencias de GeoVictoria quedan visibles para no presentar como exacta una cifra que tuvo información incompleta.

### Informe PDF de asistencia

La vista por estación permite preparar un informe PDF. Se puede elegir:

- Rango de días.
- Qué estaciones incluir.
- Qué indicadores exportar.
- Si se muestran solo los resúmenes o también el detalle de las personas.

El informe se descarga cuando los datos seleccionados están disponibles.

## Asistencia y producción

Este panel de análisis compara la cantidad de personas presentes con la producción terminada en los días hábiles.

### Elegir la producción

Se puede analizar:

- Paneles.
- Módulos.

Para paneles se puede medir:

- Cantidad.
- Metros cuadrados.
- Metros lineales.

Para módulos se mide la cantidad de módulos terminados.

### Elegir un grupo de personas

El filtro Cohorte permite comparar:

- Todas las personas disponibles.
- Un supervisor.
- Un centro de costo.

La aplicación puede mostrar un centro de costo con la abreviatura CECO. Es el código que permite relacionar personas de BUK con un equipo o grupo de trabajo.

### Resumen

La parte superior muestra:

- Personas del grupo elegido según BUK.
- Promedio de asistencia.
- Producción total.
- Promedio diario.
- Personas o grupos que aún no se pudieron relacionar.

Solo considera días hábiles comparables. Si falta la información de asistencia o producción de un día, la pantalla lo advierte.

### Serie y dispersión

En Serie se ve día por día la asistencia y la producción. En Dispersión, cada punto representa un día y se dibuja una línea de tendencia cuando hay suficiente variación.

La línea no demuestra que la asistencia sea la única causa de la producción. Sirve para observar si ambas variables tienden a moverse juntas durante el rango elegido.

### Jornadas equivalentes

Esta parte estima cuántas jornadas completas representan las horas netas de trabajo. Por ejemplo, si el grupo acumuló horas equivalentes a diez jornadas completas, el resultado será diez, aunque hayan participado más o menos de diez personas.

Se pueden configurar:

- Hora de inicio.
- Minutos de colación.
- Otros minutos que se quieran descontar.
- Horas semanales de referencia.

El resumen muestra:

- Jornadas completas equivalentes en promedio.
- Horas netas.
- Horas extra.
- Cantidad de personas.
- Cantidad de centros de costo.

La tabla por centro de costo muestra personas, días presentes, horas, horas extra y jornadas completas equivalentes en promedio. Al abrir un centro de costo se pueden revisar sus personas y las marcas que superaron la jornada de referencia.

### Relación con BUK y respaldo por centro de costo

BUK entrega una lista de personas y sus centros de costo. SCP intenta relacionarlas con las personas locales y con sus supervisores.

Si una persona está vinculada directamente a un supervisor local, se utiliza esa relación. Si no, el panel de análisis puede usar el centro de costo como relación de respaldo, siempre que un administrador haya asignado ese centro de costo a un supervisor.

Los vínculos se pueden:

- Asignar a un supervisor local.
- Dejar sin vínculo.
- Marcar como No incluir.
- Separar para paneles y para módulos.

Estos ajustes se guardan en el navegador o dispositivo. La pantalla muestra cuántas personas quedaron resueltas y cuántas siguen sin relación.

## Reglas que protegen el orden de producción

### La tarea más específica gana

Cuando hay varias reglas para una tarea, la aplicación intenta usar la regla que describe con mayor precisión el caso. Una regla para un panel concreto tiene prioridad sobre una regla general.

Esto evita que una tarea general reemplace por error la configuración especial de un panel.

### Las condiciones deben coincidir

Una tarea con una condición Es necesita que el módulo tenga uno de los valores elegidos. Una tarea con una condición No es necesita que no tenga ninguno.

Si hay varias reglas, todas deben aprobarse. Basta que una no coincida para que la tarea no aplique.

### La estación se determina por tareas

Una estación que no tiene ninguna tarea aplicable para un módulo se salta durante el avance. Por eso dos módulos de la misma casa pueden recorrer estaciones distintas si sus paneles, subtipo o condiciones son diferentes.

### El historial no se borra al corregir un estado

Cambiar manualmente el estado de un módulo no reconstruye lo que ocurrió. No elimina tareas ni paneles. La corrección de una tarea elegible es una acción diferente y más específica.

### Las definiciones archivadas no se usan en trabajos nuevos

Archivar una casa, panel, tarea, condición, razón de pausa o plantilla evita que se use en nuevas operaciones. La información histórica permanece para los informes y para las revisiones.

### Las reglas se comprueban en la pantalla y al guardar

Aunque un botón se vea disponible, la aplicación vuelve a comprobar las reglas al momento de guardar. Esto evita que dos personas cambien el mismo módulo de forma incompatible o que se inicie una tarea ya movida por otra persona.

## Permisos

### Roles principales

La instalación puede usar roles como:

- Supervisor.
- Administrador.
- Administrador principal.
- Calidad.
- Prevencionista.

El nombre visible del rol puede variar según la configuración.

### Ver y editar son permisos diferentes

Para cada página, el administrador principal puede decidir:

- Si un rol puede verla.
- Si un rol puede editarla.

Si se quita Ver, también se quita Editar. Si se activa Editar, se activa Ver.

Una persona con solo lectura puede revisar la información, pero los formularios y acciones de guardado quedan bloqueados. La aplicación muestra el aviso Tienes acceso de solo lectura en esta página.

Los permisos se comprueban también al intentar guardar. Ocultar un botón no es la única protección.

### Dashboards

Los dashboards tienen además su propia visibilidad por rol. Una persona puede tener acceso a la administración, pero no a todos los análisis.

El administrador principal no queda bloqueado por las restricciones normales de página y panel de análisis.

## Qué ocurre cuando hay datos incompletos

SCP muestra avisos en lugar de inventar información.

Ejemplos:

- Si una persona no tiene vínculo con GeoVictoria, se puede ver su actividad de SCP, pero no sus marcajes externos.
- Si GeoVictoria no responde, los dashboards muestran los datos locales disponibles y un aviso.
- Si BUK no responde, no se puede completar el respaldo por centro de costo.
- Si una cámara no tiene grabación, la tarea se conserva sin video.
- Si no hay una impresora Zebra configurada, la vista previa sigue disponible.
- Si no existe una estación con tareas aplicables, el módulo queda en la estación final para revisión.
- Si no hay marcajes de una estación, la estimación indica Sin turno.

## Páginas auxiliares y límites actuales de la versión revisada

### Resumen del día y Resumen general

Las rutas Resumen del día y Resumen general aparecen en el menú de utilidades, pero en la versión revisada muestran una pantalla pendiente o de presentación. No deben confundirse con los dashboards de asistencia, producción o calidad que sí tienen cálculos visibles.

### Vista de planta

Aunque la tarjeta la describa como mapa vivo, la pantalla actual reproduce datos cargados desde una tabla o desde una demostración. No sustituye la supervisión que consulta las estaciones y sus módulos reales.

### Objetivo diario de paneles

El objetivo se guarda en el dispositivo donde se configuró. No es una meta central que se replique automáticamente a todas las tablets.

### Campanas de notificación del operador

La cabecera del operador puede mostrar una cantidad de notificaciones de retrabajo. El indicador existe para informar, pero el botón de campana de esa cabecera está deshabilitado en la versión revisada. Los retrabajos se gestionan desde sus tarjetas y desde las pantallas de calidad.

### Asistencia externa

Los dashboards de asistencia dependen de que GeoVictoria y, en algunos análisis, BUK entreguen información. Las advertencias de cobertura forman parte del resultado y deben revisarse antes de comparar personas o días.

### Turnos estimados

La regla actual fija el comienzo a las 08:20 y resta treinta minutos a la última salida. Si la planta cambia de horario, la interpretación del informe debe tenerlo en cuenta.

### Eliminación de controles de calidad

La pantalla contempla una ventana de cuarenta y ocho horas, pero la comprobación de tiempo aparece temporalmente desactivada en la versión revisada. Los controles fallidos con retrabajo asociado siguen protegidos.

### Sincronización y respaldos

Traer información desde producción reemplaza la información operativa local y cierra las sesiones. Es una acción de administración principal que debe hacerse después de confirmar la copia de control.

### Preferencias del dispositivo

El contexto de estación, el escaneo QR, el objetivo diario, los filtros de algunos paneles de análisis y los vínculos de centro de costo del análisis de asistencia pueden quedar guardados en el navegador o dispositivo. Cambiar de tablet no necesariamente conserva esas preferencias.

## Guía rápida por perfil

### Operador

1. Elige el contexto o estación.
2. Selecciona su nombre o usa su QR.
3. Ingresa su PIN si corresponde.
4. Abre el panel o módulo de trabajo.
5. Revisa las condiciones y las dependencias.
6. Inicia, pausa, reanuda y termina las tareas.
7. Escribe notas y razones de pausa.
8. Atiende los retrabajos que aparezcan.
9. Cierra la sesión al retirarse.

### Supervisor

1. Abre Vista de supervisor.
2. Revisa paneles, módulos y estaciones.
3. Observa tareas atrasadas, checks fallidos, retrabajos y observaciones.
4. Abre los detalles que necesiten acción.
5. Comenta observaciones y adjunta fotos.
6. Propone cierres cuando el hallazgo está resuelto.
7. En Protocolos, firma las versiones que le corresponden.

### Calidad

1. Abre el Menú de calidad.
2. Revisa checks pendientes y retrabajos.
3. Filtra por estación o módulo.
4. Ejecuta la revisión siguiendo la pauta.
5. Adjunta evidencia.
6. Aprueba o registra la falla con severidad y modo de falla.
7. Revisa y completa los retrabajos.
8. Reinspecciona el elemento corregido.
9. Cierra observaciones cuando la evidencia es suficiente.
10. Consulta los dashboards de cumplimiento y fallas.

### Administrador

1. Configura tipos de casa, subtipos, módulos y paneles.
2. Configura tareas, tiempos, estaciones y condiciones.
3. Registra personas, supervisores y especialidades.
4. Crea lotes y ordena la cola.
5. Ajusta líneas, fechas y condiciones.
6. Consulta históricos y dashboards.
7. Administra protocolos si tiene permisos.

### Administrador principal

Además de lo anterior:

1. Administra cuentas administrativas.
2. Define permisos por página y panel de análisis.
3. Gestiona estaciones protegidas.
4. Crea y restaura copias de seguridad.
5. Ejecuta la sincronización local desde producción.
6. Configura etiquetas e impresora.
7. Revisa la cobertura de asistencia y los vínculos de centro de costo.

## Resumen final

SCP funciona como un hilo continuo entre la definición del producto y la realidad de la planta. La configuración dice qué debería hacerse. La cola dice qué debe fabricarse y en qué orden. Las estaciones registran lo que realmente se hizo. Las pausas, notas, participantes y evidencias explican cómo ocurrió. Los controles de calidad comprueban el resultado y los retrabajos mantienen el problema visible hasta que se corrige. Los dashboards reúnen todo ese historial para ayudar a decidir con información concreta.

La aplicación no trata todos los módulos, paneles ni personas como si fueran iguales. Usa el tipo de casa, el subtipo, el número de módulo, el panel, las condiciones, la estación, las dependencias y los permisos para decidir qué corresponde en cada caso. Esa es la razón por la que algunas tareas aparecen para un elemento y no para otro, por la que un módulo puede saltarse una estación y por la que ciertas acciones quedan bloqueadas hasta que se completa un paso anterior.
