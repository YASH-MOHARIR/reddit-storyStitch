// Learn more at developers.reddit.com/docs
import { Devvit, useAsync, useChannel, useForm, useState } from "@devvit/public-api";
import { storyPrompts } from "./storyPromptsDB.js";
import { wordPrompts } from "./promptWordsDB.js";

Devvit.configure({
  redditAPI: true,
  redis: true,
  realtime: true,
});

// Add a menu item to the subreddit menu for instantiating the new experience post
Devvit.addMenuItem({
  label: "Add Story Stitch Post",
  location: "subreddit",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    ui.showToast("Submitting your post - upon completion you'll navigate there.");

    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: "A Story Stitch Post",
      subredditName: subreddit.name,
      // The preview appears while the post loads
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading StoryStitch... Fun Awaits !</text>
        </vstack>
      ),
    });
    ui.navigateTo(post);
  },
});

// Add a post type definition
Devvit.addCustomPostType({
  name: "Experience Post",
  height: "regular",
  render: (context) => {
    const { postId, redis } = context;

    //using realtime to update the story in real time
    const channel = useChannel({
      name: `storyUpdate`,
      onMessage: (storyDate: string) => {
        setStory(storyDate);
      },
    });

    channel.subscribe();

    // initial story ( fetched from redis)
    const [story, setStory] = useState<string>(async function fetchStoryFromRedis() {
      try {
        const redisKey = `story:${postId}`;
        const storedStory = await redis.get(redisKey);

        console.log("fetching from id with key", redisKey);
        console.log("Story fetched from Redis:", storedStory);

        if (storedStory) {
          return storedStory;
        } else {
          console.log("No story found in Redis. Using default story.");
          const randomIndex = Math.floor(Math.random() * storyPrompts.length);
          const initialStory = storyPrompts[randomIndex];
          await redis.set(redisKey, initialStory);
          return initialStory;
        }
      } catch (error) {
        console.error("Error fetching story from Redis:", error);
        return "Failed to load the story. Please try again.";
      }
    });
    //states
    const [userPreviousComment, setUserPreviousComment] = useState<string>(async function fetchCommentFromRedis() {
      // Check for previous comments
      const redisKey = `${postId}:${context.userId}`;
      const previousComment = await getCommentFromRedis(redisKey);
      console.log("Previous comment:", previousComment);
      return previousComment?.toString() || "";
    });
    // const [promptWords, setPromptWords] = useState<string[]>(["word1", "word2", "word3"]);
    const [promptWords, setPromptWords] = useState<string[]>(() => {
      //select 3 random words from the promptWordsDB
      const words = [];
      const randomIndex = Math.floor(Math.random() * wordPrompts.length);
      words.push(wordPrompts[randomIndex]);
      words.push(wordPrompts[(randomIndex + 1) % wordPrompts.length]);
      words.push(wordPrompts[(randomIndex + 2) % wordPrompts.length]);

      return words;
    });

    //FORMS to take story sentence input from user
    const myForm = useForm(
      {
        description: `your prompt words are ${promptWords[0]}, ${promptWords[1]}, ${promptWords[2]}`,
        fields: [
          {
            type: "string",
            name: "userInput",
            label: "Enter your sentence",
            required: true,
          },
        ],
      },
      async (values) => {
        // Check if the user has already added a comment
        if (userPreviousComment) {
          context.ui.showToast(`You already added a comment: "${userPreviousComment}". Do you want to overwrite it?`);
        } else {
          submitHandler(values);
        }
      }
    );

    const instructionModal = useForm(
      {
        fields: [],
        title: "Instructions - How to Play",
        description:
          "Welcome to StoryStitcher! 🌟 " +
          "Collaborate with others to create an amazing story. The game begins with a prompt, and your task is to add a sentence with 1–10 words to continue the narrative. You must include at least 1 of the 3 optional words provided for each round to score points. Using at least 2 out of 3 words will maximize your score! Each player is allowed to submit only 1 response per round, so make your sentence count. Ensure your sentence is grammatically correct and connects meaningfully to the previous part of the story. Example: If the prompt is 'The knight stood at the edge of the forest,' your sentence could be, 'He stepped forward, determined to face the shadows ahead.' Let your creativity flow and enjoy building a story together with the community! 🌟",
        cancelLabel: "Close",
        acceptLabel: "Scoring Points",
      },
      () => {
        context.ui.showForm(instructionModal2);
      }
    );

    const instructionModal2 = useForm(
      {
        fields: [],
        title: "Scoring Points",
        description:
          "You can earn points by using the optional words provided for each round. If you use at least 2 out of 3 prompt words, you'll earn 3 points for each occurrence of those words. If you use only 1 prompt word, you'll earn 1 point per word, regardless of repetitions. Sentences without any prompt words earn no points.",
        cancelLabel: "Close",
        acceptLabel: "Lets Play !",
      },
      () => {}
    );

    //function to handle form submission
    async function submitHandler(values: any) {
      const userInput = values.userInput;

      // Validate input
      const isValid = validateInput(userInput);
      if (!isValid) return;

      try {
        const redisKey = `story:${postId}`;

        const updatedStory = story + " " + userInput.trim();
        setStory(updatedStory);
        // update the user's previous comment
        setUserPreviousComment(userInput);

        // Update Redis with the new story
        await redis.set(redisKey, updatedStory);

        // Store the user's comment in Redis
        const redisCommentKey = `${postId}:${context.userId}`;
        storeCommentInRedis(redisCommentKey, userInput).then(() => {
          setUserPreviousComment(userInput);
        });
        channel.send(updatedStory);

        context.ui.showToast("Kuddos !! Your sentence has been added to the story!");
      } catch (error) {
        console.error("Error updating story in Redis:", error);
        context.ui.showToast("Failed to update the story. Please try again.");
      }
    }

    async function storeCommentInRedis(key: string, comment: string): Promise<void> {
      try {
        await redis.set(key, comment); // Store the comment under the key
        console.log(`Comment stored in Redis under key: ${key}`);
      } catch (error) {
        console.error("Error storing comment in Redis:", error);
      }
    }

    async function getCommentFromRedis(key: string): Promise<string | undefined> {
      try {
        const comment = await redis.get(key); // Retrieve the comment by key
        console.log(`Retrieved comment from Redis: ${comment}`);
        return comment;
      } catch (error) {
        console.error("Error retrieving comment from Redis:", error);
        return undefined;
      }
    }

    function validateInput(userInput: string) {
      const wordCount = userInput.trim().split(/\s+/).length; // Count words by splitting on spaces
      const promptWordsUsed = promptWords.filter((word) => userInput.toLowerCase().includes(word.toLowerCase())); // Check which prompt words are used

      // Validate word count
      if (wordCount > 10 || wordCount < 1) {
        context.ui.showToast("Please enter a sentence with 1–10 words.");
        return false;
      }

      // Ensure the sentence ends with punctuation
      const endsWithPunctuation = /[.!?]$/.test(userInput.trim());
      if (!endsWithPunctuation) {
        context.ui.showToast("Please end your sentence with a period, exclamation mark, or question mark.");
        return false;
      }

      // Ensure at least one prompt word is included
      if (promptWordsUsed.length < 1) {
        context.ui.showToast(`Please include at least one of the prompt words: ${promptWords.join(", ")}.`);
        return false;
      }

      // Scoring logic
      let totalPoints = 0;
      const pointsBreakdown: string[] = [];

      // Count occurrences of each prompt word
      for (const word of promptWords) {
        const regex = new RegExp(`\\b${word}\\b`, "gi"); // Match whole words, case-insensitive
        const matches = userInput.match(regex) || [];
        const occurrences = matches.length;

        if (occurrences > 0) {
          if (promptWordsUsed.length >= 2) {
            totalPoints += occurrences; // Full points for each occurrence
          } else {
            totalPoints += 1; // Only 1 point if less than 2 prompt words are used
          }
          pointsBreakdown.push(`${word}: ${occurrences} point(s)`);
        }
      }

      // Update story and display points
      setStory((prev) => prev + " " + userInput.trim() + " ");
      if (totalPoints > 0) {
        context.ui.showToast(
          `Sentence added to the story! You earned ${totalPoints} point(s): ${pointsBreakdown.join(", ")}.`
        );
      } else {
        context.ui.showToast("Sentence added to the story! No bonus points earned.");
      }

      return true;
    }

    async function postComment(commentText: string, context: Devvit.Context) {
      try {
        // Check if we have a postId in the context
        if (!context.postId) {
          throw new Error("No post ID available in the current context");
        }

        const fullCommentText = `**I added:** ${commentText}`;

        const result = await context.reddit.submitComment({
          id: context.postId,
          text: fullCommentText,
        });

        context.ui.showToast("Comment posted successfully! Please refresh the page to view your comment.");
        return result;
      } catch (error) {
        context.ui.showToast("Failed to post comment. Please try again.");
        console.error("Error posting comment:", error);
        throw error;
      }
    }

    return (
      <zstack height="100%" width="100%">
        <image url="bg-3.png" height="100%" width="100%" resizeMode="cover" imageWidth={100} imageHeight={100} />

        <vstack backgroundColor="#D3F8FF70" height="100%" width="100%" gap="medium" alignment="center middle">
          <image url="logo.png" description="logo" imageHeight={256} imageWidth={256} height="48px" width="48px" />

          <text size="xxlarge"> Welcome to StoryStich ! 🌟</text>
          <vstack backgroundColor="#86c4fe80" padding="medium" cornerRadius="medium">
            <text size="xlarge" color="#024f97" weight="bold">
              Current Story :
            </text>
            <text size="xlarge" color="#024f97" wrap>
              {story}
            </text>
            {userPreviousComment && (
              <text size="small" color="#024f97">
                Your Story Addition : {userPreviousComment}
              </text>
            )}
          </vstack>
          {/* <vstack backgroundColor="#86c4fe80" padding="small" cornerRadius="medium">
            {userPreviousComment && (
              <text size="small" color="#024f97">
                Your Story Addition : {userPreviousComment}
              </text>
            )}
          </vstack> */}

          <hstack gap="small" padding="medium" backgroundColor="#86c4fe90" cornerRadius="medium">
            <button appearance="secondary" onPress={() => context.ui.showForm(instructionModal)}>
              View Instructions
            </button>
            {userPreviousComment ? (
              <button
                onPress={async () => {
                  await postComment(userPreviousComment, context);
                }}>
                Post story addition as comment!! Let the world know :D
              </button>
            ) : (
              <button appearance="primary" onPress={() => context.ui.showForm(myForm)}>
                Start Game !
              </button>
            )}
          </hstack>
        </vstack>
      </zstack>
    );
  },
});

export default Devvit;
