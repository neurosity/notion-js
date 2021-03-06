---
id: brainwaves
title: Brainwaves
---
The brainwaves API is what we always wished for when it came to inventing the future: an easy way to get lossless brainwaves. Sometimes we wanted to manipulate the raw data and other times we wanted to analyze the power in each frequency bin. With brainwaves, our goal is to enable new APIs and powerful programs to be built. We expect that someone working with the brainwaves API has a bit of experience working with raw brainwave data or a strong desire to learn.

## Metrics

There are four metrics:

- raw
- frequency
- psd

```js
const mind = new Notion();

mind.brainwaves().subscribe(brainwaves => {
  console.log(brainwaves);
  /* 
  {
    data: [Number, ... , Number],
    timestamp: Date,
    frequency: [
      [Number, ... , Number]
    ],
    psd: [Number, ... , Number]
  }
  */
});
```

Optionally, metrics can be filtered by adding their comma-separated names.

```js
brainwaves("frequency").subscribe(brainwaves => {
  console.log(brainwaves);
  /* 
  { frequency: [
      [Number, ... , Number]
    ]
  }
  */
});
```

### Raw

Raw data is what comes directly from the analog to digital converter. Note that you will see environmental noise in the signal which should be filtered out. As well as DC drift in the signal that will need to be filtered out for most cases. Raw data is eight channels sampled at 250 Hz, aka samples per second.

### Frequency


### PSD

