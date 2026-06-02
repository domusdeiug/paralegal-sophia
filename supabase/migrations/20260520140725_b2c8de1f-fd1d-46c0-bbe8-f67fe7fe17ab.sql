
-- Enums
CREATE TYPE public.subscription_tier AS ENUM ('Basic', 'Pro', 'Premium');
CREATE TYPE public.document_kind AS ENUM ('monthly_report', 'activity_report', 'court_submission', 'legal_corpus');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'Basic',
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Cases
CREATE TABLE public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  old_new TEXT,
  lac_file_no TEXT NOT NULL,
  court_case_no TEXT,
  client_name TEXT NOT NULL,
  sex TEXT,
  age INTEGER,
  residence TEXT,
  nature_of_case TEXT,
  vulnerability TEXT,
  action_taken TEXT,
  status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_user_date ON public.cases(user_id, date DESC);
CREATE INDEX idx_cases_user_file ON public.cases(user_id, lac_file_no);
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cases_select_own" ON public.cases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cases_insert_own" ON public.cases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cases_update_own" ON public.cases FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cases_delete_own" ON public.cases FOR DELETE USING (auth.uid() = user_id);

-- User documents
CREATE TABLE public.user_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.document_kind NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_documents_user_kind ON public.user_documents(user_id, kind);
ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docs_select_own" ON public.user_documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "docs_insert_own" ON public.user_documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "docs_update_own" ON public.user_documents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "docs_delete_own" ON public.user_documents FOR DELETE USING (auth.uid() = user_id);

-- Legal corpus chunks (for embeddings/RAG later)
CREATE TABLE public.legal_corpus_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.user_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_corpus_user ON public.legal_corpus_chunks(user_id);
ALTER TABLE public.legal_corpus_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corpus_select_own" ON public.legal_corpus_chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "corpus_insert_own" ON public.legal_corpus_chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "corpus_delete_own" ON public.legal_corpus_chunks FOR DELETE USING (auth.uid() = user_id);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('user-documents', 'user-documents', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "user_docs_select_own" ON storage.objects FOR SELECT
  USING (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "user_docs_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "user_docs_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "user_docs_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'user-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
