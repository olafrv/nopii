export const fixtures = [
  { text: "Please forward this to Alexandra Kovacs.", type: "PERSON", shouldRedact: true },
  { text: "The package is addressed to James O'Brien.", type: "PERSON", shouldRedact: true },
  { text: "CC: Dr. Yuki Tanaka on all replies.", type: "PERSON", shouldRedact: true },
  { text: "Send the invoice to billing@contoso.io.", type: "EMAIL", shouldRedact: true },
  { text: "My work email is m.okafor+lists@university.edu.", type: "EMAIL", shouldRedact: true },
  { text: "Call me at +1 (415) 555-0192.", type: "PHONE", shouldRedact: true },
  { text: "The server IP is 192.168.10.42 internally.", type: "IP_ADDRESS", shouldRedact: true },
  { text: "The conference is held in Berlin.", type: "LOCATION", shouldRedact: false },
  { text: "The CEO signed off on Thursday.", type: "PERSON", shouldRedact: false },
];
