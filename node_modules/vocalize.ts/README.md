# Vocalize.ts

![logo](https://i.ibb.co/RSHbfQD/Vocalize.png)

Vocalize.ts is a TypeScript library designed to integrate speech recognition and synthesis into web applications. With Vocalize.ts, you can easily set up voice commands that trigger actions and have your app respond by speaking back to the user.

![npm version](https://img.shields.io/npm/v/vocalize.ts)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/vocalize.ts)
![License](https://img.shields.io/github/license/j3rry320/vocalize.ts)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)
![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)

## Features

- **Speech Recognition:** Easily add voice command recognition to your web app.
- **Speech Synthesis:** The app can speak back responses based on recognized commands.
- **Custom TTS Options:** Configure text-to-speech settings for each command action.

# Important Note

**User Event Initialization:** The SpeechSynthesizer initializes and speaks only after a user event (e.g., button click, mouseup) to comply with browser security policies. Otherwise, the library won't be able to talk back to the user. Each command can be recognized, and the callback can be called, but without the TTS feature.

## Motivation

I created Vocalize.ts to simplify the process of adding voice interactions to web applications. Many existing libraries are either too complex or don't provide straightforward integration with speech synthesis. Vocalize.ts aims to bridge this gap by offering a minimal setup and focusing on ease of use.

## Installation

You can install Vocalize.ts via npm or yarn:

```bash
npm install vocalize.ts
```

or

```bash
yarn add vocalize.ts
```

## Usage

Here’s a basic example of how to use Vocalize.ts:

```typescript
import { Vocalize } from "vocalize.ts";

// Create a new instance of Vocalize
const vocalize = new Vocalize({
  recognitionOptions: {
    lang: "en-US",
    continuous: false,
    interimResults: false,
  },
  ttsOptions: {
    volume: 1,
    rate: 1,
    pitch: 1,
  },
  presetMood: "happy",
  onCommandRecognized: (phrase) => {
    console.log(`Command recognized: ${phrase}`);
  },
  onCommandUnrecognized: (phrase) => {
    console.log(`Command not recognized: ${phrase}`);
  },
  onError: (error) => {
    console.error(`Speech recognition error: ${error.message}`);
  },
});

// Register commands
vocalize.registerCommands([
  {
    phrase: "hello world",
    action: () => ({
      speak: true,
      text: "Hello, world!",
      options: {
        rate: 1.2,
      },
      callback: () => {
        console.log("Hello World Action Called");
      },
    }),
  },
]);

// Start listening for commands
vocalize.startListening();
```

## Key Concepts

- **User Event Initialization:** Ensure the library is initialized after a user event (e.g., button click) to comply with browser policies.
- **Command Registration**: Register commands and their corresponding actions.
- **Speech Synthesis**: Configure how the app speaks back using TTS options.

## Documentation

### Class: `Vocalize`

The `Vocalize` class provides methods to integrate speech recognition and synthesis into your web application.

#### Constructor

```typescript
constructor(options: VoiceCommandOptions = {})
```

**Parameters:**

- `options`: An object to configure the instance with the following properties:
  - `recognitionOptions` (optional): Options for the SpeechRecognition API (see [SpeechRecognition API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)).
  - `ttsOptions` (optional): Default options for text-to-speech (see [SpeechSynthesis API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)).
  - `onCommandRecognized` (optional): Callback function that is called when a command is recognized.
  - `onCommandUnRecognized` (optional): Callback function that is called when a command is not recognized.
  - `onError` (optional): Callback function that is called when an error occurs during speech recognition.
  - `presetMood` (optional): This option allows you to configure the text-to-speech (TTS) settings based on predefined mood settings. Look below to find the default settings

#### Methods

1.  **`registerCommands(commands: Command[]): void`**

    Registers a list of commands that the library will recognize.

    **Parameters:**

    - `commands`: An array of `Command` objects, where each object has:
      - `phrase`: The command phrase to recognize.
      - `action`: A function that returns an object with the following properties:
        - `speak` (optional): A boolean indicating whether the app should speak back.
        - `text` (optional): The text to be spoken if `speak` is true.
        - `options` (optional): TTS options specific to this command.
        - `callback` (optional): A function to be called when the command is executed.

    **Example:**

```typescript
vocalize.registerCommands([
  {
    phrase: "hello world",
    action: () => ({
      speak: true,
      text: "Hello, world!",
      options: { rate: 1.2 },
      callback: () => console.log("Hello World Action Called"),
    }),
  },
]);
```

2.  **`startListening(): void`**

    Starts listening for speech input.

    **Usage:**

    ```typescript
    vocalize.startListening();
    ```

3.  **`stopListening(): void`**

    Stops listening for speech input.

    **Usage:**

    ```typescript
    vocalize.stopListening();
    ```

4.  **`setTTSOptions(options: SpeechOptions): void`**

    Sets the default text-to-speech options for the instance.

    **Parameters:**

    - `options`: An object with TTS settings:
      - `volume` (optional): Volume level (0.0 to 1.0).
      - `rate` (optional): Speech rate (0.1 to 10).
      - `pitch` (optional): Speech pitch (0 to 2).

    **Example:**

    ```typescript
    vocalize.setTTSOptions({ volume: 1, rate: 1, pitch: 1 });
    ```

5.  **`getVoices(): Promise<SpeechSynthesisVoice[]>`**

    Retrieves the available voices for speech synthesis.

    **Returns:**

    - A promise that resolves with an array of `SpeechSynthesisVoice` objects.

    **Usage:**

    ```typescript
    vocalize.getVoices().then((voices) => console.log(voices));
    ```

6.  **`setVoices(): Promise<void>`**
    Sets a particular voice for speech synthesis based on a combination of language, name, and voiceURI.
    **Parameters:**

    - `options`: An object including the parameters to look up the voice:
      - `language`: The language code to filter voices (e.g., "en-US").
      - `name` (optional): The name of the voice to select.
      - `voiceURI` (optional): The URI of the voice to select.
      ```typescript
      await vocalize.setVoice({
        language: "en-US",
        name: "Rishi",
        voiceURI: "Rishi",
      });
      ```

### Types

#### `Command`

Represents a command and its associated action.

**Properties:**

- `phrase`: The phrase to recognize.
- `action`: A function returning an object with:
  - `speak` (optional): Boolean to determine if the app should speak.
  - `text` (optional): Text to be spoken.
  - `options` (optional): TTS options specific to the command.
  - `callback` (optional): Function to call upon execution.

#### `SpeechOptions`

Options for text-to-speech synthesis.

**Properties:**

- `volume` (optional): Volume level (0.0 to 1.0).
- `rate` (optional): Speech rate (0.1 to 10).
- `pitch` (optional): Speech pitch (0 to 2).
- Refer to MDN Docs to learn about other config properties that can be passed as SpeechOptions

#### `VoiceCommandOptions`

Options for configuring the `Vocalize` instance.

**Properties:**

- `recognitionOptions` (optional): Configuration for speech recognition.
- `ttsOptions` (optional): Default TTS settings.
- `onCommandRecognized` (optional): Callback for when a command is recognized.
- `onError` (optional): Callback for errors during recognition.

Please refer to the MDN docs to learn more about the config options
[SpeechRecognition API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
[SpeechSynthesis API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)

### Preset Mood Configuration

This object contains predefined TTS settings for various moods:

```json
{
  "happy": { "volume": 1.0, "rate": 1.2, "pitch": 1.5 },
  "calm": { "volume": 0.8, "rate": 0.9, "pitch": 1.0 },
  "sad": { "volume": 0.7, "rate": 0.8, "pitch": 0.8 },
  "angry": { "volume": 1.0, "rate": 1.1, "pitch": 1.3 },
  "surprised": { "volume": 1.0, "rate": 1.2, "pitch": 1.4 },
  "neutral": { "volume": 1.0, "rate": 1.0, "pitch": 1.0 }
}
```

**Note:** If the `presetMood` provided does not match any of the predefined moods, the library will use the default TTS settings specified in `ttsOptions`.

## Contributing

We welcome contributions! If you have ideas for new features or improvements, please open an issue or submit a pull request.

### Running and Testing

To ensure a smooth contribution process, please follow these instructions:

1. **Install Dependencies:**
   First, make sure you have all the necessary dependencies installed. Run:
   ```bash
   npm install
   ```
2. **Build the Project:** Before running or testing the project, build it with:
   ```bash
   npm run build
   ```
3. **Run the Development Server:** To start the development server with live reloading, use:

   ```bash
   npm run dev
   ```

4. **Run Tests:** To run the test suite, use:
   ```bash
   npm test
   ```
5. **Clean Build Artifacts:** To remove the build artifacts, run:

   ```bash
   npm run clean
   ```

6. **Publish Changes:** To publish the updated package, make sure you’ve cleaned and built it first:

   ```bash
   npm run prepublishOnly
   ```

### Available to Hire

I'm available for hire for freelance or contract work. If you're interested in collaborating or need custom development, please reach out.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/J3rry320/Vocalize.ts/blob/main/LICENSE) file for details.
