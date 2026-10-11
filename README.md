# Screen Map

See an Android app as a flow chart. Pick an Android Studio project folder and every screen (activity, fragment, dialog) is drawn from its XML layout, with arrows from each button to the screen it opens.

- **Flow**: drag the background to pan, scroll to zoom, drag a card's title to move it. Hover a card or a button to light up its arrows. Dashed arrows happen on their own (for example "already signed in → Home").
- **Screen details**: click a screen for a large render, a plain-English description of what every button does (with its conditions), and the code behind it.
- **All layouts**: every XML layout, including list rows, dialogs and unused ones.

Everything runs in your browser and nothing is uploaded. To use it, open `index.html`, or host the folder anywhere static (GitHub Pages works).

Reads Java and Kotlin: `setContentView`, ViewBinding, `findViewById`, click listeners (anonymous classes, lambdas, `android:onClick`, `switch`/`when` on ids), `Intent`s, fragment transactions, and Navigation-component graphs. Jetpack Compose screens aren't drawn.
