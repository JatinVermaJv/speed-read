CREATE TABLE "ai_generation_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"theme" varchar(200) NOT NULL,
	"keywords" text,
	"model" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "difficulty_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_time_limit_sec" integer DEFAULT 180 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "difficulty_levels_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "unseen_attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_option_id" uuid,
	"is_correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unseen_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"unseen_passage_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"is_retry" boolean DEFAULT false NOT NULL,
	"status" varchar(30) DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"passage_expires_at" timestamp NOT NULL,
	"submitted_at" timestamp,
	"score_percent" integer,
	"total_questions" integer,
	"correct_answers" integer,
	"duration_sec" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unseen_passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text NOT NULL,
	"word_count" integer NOT NULL,
	"theme" varchar(200) DEFAULT 'General' NOT NULL,
	"keywords" text,
	"difficulty_key" varchar(50) NOT NULL,
	"time_limit_sec" integer DEFAULT 180 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"source_type" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unseen_question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unseen_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unseen_passage_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"explanation" text,
	"order_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generation_usage" ADD CONSTRAINT "ai_generation_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_attempt_answers" ADD CONSTRAINT "unseen_attempt_answers_attempt_id_unseen_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."unseen_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_attempt_answers" ADD CONSTRAINT "unseen_attempt_answers_question_id_unseen_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."unseen_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_attempt_answers" ADD CONSTRAINT "unseen_attempt_answers_selected_option_id_unseen_question_options_id_fk" FOREIGN KEY ("selected_option_id") REFERENCES "public"."unseen_question_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_attempts" ADD CONSTRAINT "unseen_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_attempts" ADD CONSTRAINT "unseen_attempts_unseen_passage_id_unseen_passages_id_fk" FOREIGN KEY ("unseen_passage_id") REFERENCES "public"."unseen_passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_passages" ADD CONSTRAINT "unseen_passages_difficulty_key_difficulty_levels_key_fk" FOREIGN KEY ("difficulty_key") REFERENCES "public"."difficulty_levels"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_passages" ADD CONSTRAINT "unseen_passages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_question_options" ADD CONSTRAINT "unseen_question_options_question_id_unseen_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."unseen_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unseen_questions" ADD CONSTRAINT "unseen_questions_unseen_passage_id_unseen_passages_id_fk" FOREIGN KEY ("unseen_passage_id") REFERENCES "public"."unseen_passages"("id") ON DELETE cascade ON UPDATE no action;