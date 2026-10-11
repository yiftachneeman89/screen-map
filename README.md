# Screen Map

### 👉 [**Open Screen Map**](https://yiftachneeman89.github.io/screen-map/) 👈

See an Android app as a flow chart. Pick an Android Studio project folder and every screen (activity, fragment, dialog) becomes a box, with a labelled arrow for each way one screen opens another.

- **Flow**: a top-to-bottom chart starting from the screen the app opens on. Each arrow is labelled with the buttons that make that jump; "Next / Back" pairs share one two-way arrow, and dashed arrows happen on their own (for example "already signed in → Home"). Screens linked by a shared bottom bar sit together in a frame, with their arrows hidden unless you switch them on. Drag the background to pan, scroll to zoom, drag a box to move it, hover a box to light up its arrows.
- **Screen view**: click a box to see the real screen drawn from its XML. Each button gets a number on the phone and a step-by-step explanation of what it does, with conditions written in plain English ("if email or password is empty") and links to the screens it opens. Click a number or button on the phone to jump to its explanation, or "Show code" to see the code behind it.
- **All layouts**: every XML layout, including list rows, dialogs and unused ones.
- **UML diagram**: the "Download UML diagram (PDF)" button at the bottom saves a PDF of your code. Page 1 is a class diagram: every class with its fields and methods, inheritance, interfaces, inner classes and which class holds which. Page 2 shows which screen opens which. It is drawn in your browser (Graphviz, jsPDF and svg2pdf load from jsDelivr the first time), so your code still isn't uploaded. The `.puml` button next to it saves the same diagram as an editable PlantUML file.

Everything runs in your browser and nothing is uploaded. To use it, open `index.html`, or host the folder anywhere static (GitHub Pages works).

Reads Java and Kotlin: `setContentView`, ViewBinding, `findViewById`, click listeners (anonymous classes, lambdas, `android:onClick`, `switch`/`when` on ids), `Intent`s, fragment transactions, and Navigation-component graphs. Jetpack Compose screens aren't drawn.
