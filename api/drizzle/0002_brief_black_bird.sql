CREATE TABLE "language_attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"selected_option_id" uuid,
	"typed_text" text,
	"is_correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" varchar(30) DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"score_percent" integer,
	"total_questions" integer,
	"correct_answers" integer,
	"duration_sec" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_language_code" varchar(20) NOT NULL,
	"level" varchar(20) DEFAULT 'A1' NOT NULL,
	"title" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_exercise_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"vocab_item_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"prompt" text NOT NULL,
	"vocab_item_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"title" varchar(255) NOT NULL,
	"objective" text NOT NULL,
	"status" varchar(30) DEFAULT 'locked' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_vocab_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"term" varchar(255) NOT NULL,
	"translation" varchar(255) NOT NULL,
	"part_of_speech" varchar(60),
	"target_example" text,
	"native_example" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generation_usage" ADD COLUMN "feature" varchar(40) DEFAULT 'unseen' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generation_usage" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "language_attempt_answers" ADD CONSTRAINT "language_attempt_answers_attempt_id_language_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."language_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_attempt_answers" ADD CONSTRAINT "language_attempt_answers_exercise_id_language_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."language_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_attempt_answers" ADD CONSTRAINT "language_attempt_answers_selected_option_id_language_exercise_options_id_fk" FOREIGN KEY ("selected_option_id") REFERENCES "public"."language_exercise_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_attempts" ADD CONSTRAINT "language_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_attempts" ADD CONSTRAINT "language_attempts_lesson_id_language_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."language_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_courses" ADD CONSTRAINT "language_courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_exercise_options" ADD CONSTRAINT "language_exercise_options_exercise_id_language_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."language_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_exercise_options" ADD CONSTRAINT "language_exercise_options_vocab_item_id_language_vocab_items_id_fk" FOREIGN KEY ("vocab_item_id") REFERENCES "public"."language_vocab_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_exercises" ADD CONSTRAINT "language_exercises_lesson_id_language_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."language_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_exercises" ADD CONSTRAINT "language_exercises_vocab_item_id_language_vocab_items_id_fk" FOREIGN KEY ("vocab_item_id") REFERENCES "public"."language_vocab_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_lessons" ADD CONSTRAINT "language_lessons_course_id_language_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."language_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_vocab_items" ADD CONSTRAINT "language_vocab_items_lesson_id_language_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."language_lessons"("id") ON DELETE cascade ON UPDATE no action;