# Screen Map

See an Android app as a flow chart. Pick an Android Studio project folder and every screen (activity, fragment, dialog) becomes a box, with a labelled arrow for each way one screen opens another.

- **Flow**: a top-to-bottom chart starting from the screen the app opens on. Each arrow is labelled with the buttons that make that jump; "Next / Back" pairs share one two-way arrow, and dashed arrows happen on their own (for example "already signed in → Home"). Screens linked by a shared bottom bar sit together in a frame, with their arrows hidden unless you switch them on. Drag the background to pan, scroll to zoom, drag a box to move it, hover a box to light up its arrows.
- **Screen view**: click a box to see the real screen drawn from its XML, next to a plain-English list of what every button does (with its conditions), links to the screens it leads to, and the code behind it. Click a button on the phone to jump to its explanation.
- **All layouts**: every XML layout, including list rows, dialogs and unused ones.

Everything runs in your browser and nothing is uploaded. To use it, open `index.html`, or host the folder anywhere static (GitHub Pages works).

Reads Java and Kotlin: `setContentView`, ViewBinding, `findViewById`, click listeners (anonymous classes, lambdas, `android:onClick`, `switch`/`when` on ids), `Intent`s, fragment transactions, and Navigation-component graphs. Jetpack Compose screens aren't drawn.
